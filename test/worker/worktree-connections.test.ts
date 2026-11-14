// Seam B: worktree connections read from a workspace's .env / .env.local through the protocol.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockHost, mountWorker, type TestWorker } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as worker from '../../src/worker/index'
import {
  parseWorktreeRef,
  resolveWorktree,
  worktreeRef,
} from '../../src/worker/worktree-connections'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'db-studio-env-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface Workspace {
  name: string
  /** Where it lives, when the folder is not the workspace's name. */
  folder?: string
  env?: string
  envLocal?: string
  hostId?: string
}

async function start(workspaces: Workspace[], settings: Record<string, string> = {}) {
  const listed = []
  for (const w of workspaces) {
    const folder = w.folder ?? w.name
    const path = join(root, folder)
    await mkdir(path, { recursive: true })
    if (w.env !== undefined) await writeFile(join(path, '.env'), w.env)
    if (w.envLocal !== undefined) await writeFile(join(path, '.env.local'), w.envLocal)
    listed.push({
      id: `id-${w.name}`,
      kind: 'worktree' as const,
      name: w.name,
      path,
      branch: 'main',
      hostId: w.hostId ?? 'local',
    })
  }
  const host = mockHost({
    settings,
    results: {
      'workspace.list': { workspaces: listed, truncated: false },
      'editor.open': { opened: true },
    },
  })
  const w: TestWorker = await mountWorker(worker, { host })
  return { host, worker: w }
}

const PG = 'postgres://app:s3cret@db.local:5433/shop'

describe('connections.list worktrees', () => {
  test('lists a workspace whose .env defines DATABASE_URL, without the password', async () => {
    const { worker: w } = await start([{ name: 'api', env: `DATABASE_URL=${PG}\n` }])

    const { worktrees } = await w.request('connections.list')

    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]).toMatchObject({ name: 'api', detail: 'app@db.local:5433/shop' })
    expect(JSON.stringify(worktrees)).not.toContain('s3cret')
    await w.deactivate()
  })

  test('names the connection after its folder, not after the workspace or its branch', async () => {
    const { worker: w } = await start([
      {
        name: 'feat/1-modo-noche',
        folder: 'shop-api',
        env: `DATABASE_URL=${PG}\n`,
      },
    ])

    const { worktrees } = await w.request('connections.list')

    expect(worktrees[0]?.name).toBe('shop-api')
    await w.deactivate()
  })

  test('.env.local overrides .env', async () => {
    const { worker: w } = await start([
      {
        name: 'api',
        env: `DATABASE_URL=${PG}\n`,
        envLocal: 'DATABASE_URL="mysql://root@127.0.0.1/other"\n',
      },
    ])

    const { worktrees } = await w.request('connections.list')

    expect(worktrees[0]?.detail).toBe('root@127.0.0.1:3306/other')
    await w.deactivate()
  })

  test('picks up a changed URL on the next listing', async () => {
    const { worker: w } = await start([{ name: 'api', env: `DATABASE_URL=${PG}\n` }])
    await w.request('connections.list')
    await writeFile(join(root, 'api', '.env'), 'DATABASE_URL=postgresql://u@h2/db2\n')

    const { worktrees } = await w.request('connections.list')

    expect(worktrees[0]?.detail).toBe('u@h2:5432/db2')
    await w.deactivate()
  })

  test('ignores other schemes, missing variables and remote workspaces', async () => {
    const { worker: w } = await start([
      { name: 'prisma', env: 'DATABASE_URL=file:./dev.db\n' },
      { name: 'redis', env: 'DATABASE_URL=redis://localhost\n' },
      { name: 'none', env: 'OTHER=postgres://u@h/db\n' },
      { name: 'bare' },
      { name: 'remote', env: `DATABASE_URL=${PG}\n`, hostId: 'ssh' },
      { name: 'good', env: `export DATABASE_URL='${PG}' # dev\n` },
    ])

    const { worktrees } = await w.request('connections.list')

    expect(worktrees.map((e) => e.name)).toEqual(['good'])
    await w.deactivate()
  })

  test('the envVariable setting chooses the variable', async () => {
    const { worker: w } = await start(
      [{ name: 'api', env: `DATABASE_URL=${PG}\nDB_URL=mysql://u@h/other\n` }],
      { envVariable: 'DB_URL' },
    )

    const { worktrees } = await w.request('connections.list')

    expect(worktrees.map((e) => e.detail)).toEqual(['u@h:3306/other'])
    await w.deactivate()
  })

  test('stores nothing from the .env', async () => {
    const { host, worker: w } = await start([{ name: 'api', env: `DATABASE_URL=${PG}\n` }])
    await w.request('connections.list')
    await w.request('connections.list')

    expect(JSON.stringify(host.data())).not.toContain('s3cret')
    expect(JSON.stringify(host.data())).not.toContain('db.local')
    await w.deactivate()
  })
})

describe('panel detail', () => {
  test('leaves out a missing user and database', async () => {
    const { worker: w } = await start([{ name: 'api', env: 'DATABASE_URL=postgres://localhost\n' }])

    expect((await w.request('connections.list')).worktrees[0]?.detail).toBe('localhost:5432')
    await w.deactivate()
  })
})

describe('dotenv syntax', () => {
  test('reads a BOM-prefixed file and a value with an escaped quote', async () => {
    const { worker: w } = await start([
      { name: 'bom', env: `\uFEFFDATABASE_URL=${PG}\n` },
      { name: 'esc', env: 'DATABASE_URL="postgres://u:p\\"w@h/db"\n' },
    ])

    const { worktrees } = await w.request('connections.list')

    expect(worktrees.map((e) => [e.name, e.detail])).toEqual([
      ['bom', 'app@db.local:5433/shop'],
      ['esc', 'u@h:5432/db'],
    ])
    await w.deactivate()
  })
})

describe('worktree connection refs', () => {
  test('a ref naming another variable than the configured one is refused', async () => {
    const env = `DATABASE_URL=${PG}\nOTHER_URL=${PG}\n`
    const { worker: w } = await start([{ name: 'api', env }])
    const ref = (await w.request('connections.list')).worktrees[0]?.ref ?? ''
    await w.deactivate()
    const { worker: changed } = await start([{ name: 'api', env }], { envVariable: 'OTHER_URL' })

    await expect(changed.request('explorer.listObjects', { ref })).rejects.toThrow(
      /not the configured connection variable/,
    )
    await changed.deactivate()
  })

  test('a ref that is not listed fails like any unknown connection', async () => {
    const { worker: w } = await start([{ name: 'api' }])

    await expect(
      w.request('explorer.listObjects', { ref: 'env:DATABASE_URL:id-api' }),
    ).rejects.toThrow()
    await w.deactivate()
  })
})

describe('encryption from the URL', () => {
  /** Only what resolveWorktree asks of Orca: the workspaces it lists and the configured variable. */
  function orcaWith(path: string) {
    return {
      host: {
        call: async () => ({
          workspaces: [
            { id: 'w1', kind: 'worktree', name: 'neon', path, branch: 'main', hostId: 'local' },
          ],
          truncated: false,
        }),
      },
      settings: { get: async () => 'DATABASE_URL' },
    } as unknown as OrcaWorkerApi
  }

  test('a Neon URL carrying sslmode=require reaches the driver encrypted', async () => {
    const path = join(root, 'neon')
    await mkdir(path, { recursive: true })
    await writeFile(
      join(path, '.env'),
      'DATABASE_URL=postgresql://u:pw@ep-x.eu-central-1.aws.neon.tech/shop?sslmode=require\n',
    )
    const ref = parseWorktreeRef(worktreeRef({ variable: 'DATABASE_URL', workspaceId: 'w1' }))
    if (!ref) throw new Error('el ref del espacio de trabajo no se pudo leer')

    const target = await resolveWorktree(orcaWith(path), ref)

    expect(target.config).toEqual({
      engine: 'postgres',
      host: 'ep-x.eu-central-1.aws.neon.tech',
      port: 5432,
      database: 'shop',
      user: 'u',
      ssl: 'require',
    })
    expect(target.password).toBe('pw')
  })

  test('a URL with no sslmode asks for no encryption', async () => {
    const path = join(root, 'plain')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, '.env'), `DATABASE_URL=${PG}\n`)
    const ref = parseWorktreeRef(worktreeRef({ variable: 'DATABASE_URL', workspaceId: 'w1' }))
    if (!ref) throw new Error('el ref del espacio de trabajo no se pudo leer')

    const target = await resolveWorktree(orcaWith(path), ref)

    expect(target.config).not.toHaveProperty('ssl')
  })
})
