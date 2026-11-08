// A saved PostgreSQL connection end to end: the worker's requests against a real server (needs Docker).

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { mockHost, mountWorker } from 'orca/testing'
import { afterAll, beforeAll, expect, test } from 'vitest'
import * as worker from '../../src/worker/index'

let container: StartedPostgreSqlContainer
let root: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:latest').start()
  root = await mkdtemp(join(tmpdir(), 'db-studio-pg-'))
  await mkdir(join(root, 'api'))
}, 120_000)

afterAll(async () => {
  await container?.stop()
  await rm(root, { recursive: true, force: true })
})

test('tests, saves, browses and opens a table on a PostgreSQL connection', async () => {
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'w1',
            kind: 'worktree',
            name: 'api',
            path: join(root, 'api'),
            branch: 'main',
            hostId: 'local',
          },
        ],
        truncated: false,
      },
      'editor.open': { opened: true },
    },
  })
  const w = await mountWorker(worker, { host })
  const form = {
    name: 'Container',
    engine: 'postgres' as const,
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
  }
  const password = container.getPassword()

  await w.request('connection.test', { form, password })
  const { ref } = await w.request('connection.save', { form, password })
  const tree = await w.request('explorer.listObjects', { ref })
  expect(tree.schemas.map((s) => s.name)).toContain('public')

  const wrong = { form, password: 'not-the-password' }
  await expect(w.request('connection.test', wrong)).rejects.toThrow(
    /password authentication failed/,
  )

  const opened = await w.request('table.open', {
    ref,
    schema: 'public',
    table: 'things',
    workspaceId: 'w1',
  })
  expect(opened.status).toBe('opened')
  if (opened.status === 'opened') {
    expect(await readFile(join(root, 'api', opened.path), 'utf8')).toContain(
      `connection=${ref}\nSELECT * FROM "public"."things"`,
    )
  }
  await w.deactivate()
}, 120_000)

test('a worktree connection browses the .env database and opens tables in its own workspace', async () => {
  await mkdir(join(root, 'web'), { recursive: true })
  const url = `postgres://${container.getUsername()}:${container.getPassword()}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`
  await writeFile(join(root, 'api', '.env'), `DATABASE_URL=${url}\n`)
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: ['web', 'api'].map((name) => ({
          id: `id-${name}`,
          kind: 'worktree' as const,
          name,
          path: join(root, name),
          branch: 'main',
          hostId: 'local',
        })),
        truncated: false,
      },
      'editor.open': { opened: true },
    },
  })
  const w = await mountWorker(worker, { host })

  const { worktrees } = await w.request('connections.list')
  expect(worktrees.map((e) => e.name)).toEqual(['api'])
  const ref = worktrees[0]?.ref ?? ''
  const tree = await w.request('explorer.listObjects', { ref })
  expect(tree.schemas.map((s) => s.name)).toContain('public')

  const opened = await w.request('table.open', { ref, schema: 'public', table: 'things' })
  expect(opened.status).toBe('opened')
  if (opened.status === 'opened') {
    expect(await readFile(join(root, 'api', opened.path), 'utf8')).toContain(`connection=${ref}`)
  }
  expect(host.callsOf('editor.open')).toEqual([{ workspaceId: 'id-api', path: expect.any(String) }])

  // A new URL in the .env is used by the next request, without a restart.
  await writeFile(join(root, 'api', '.env'), `DATABASE_URL=${url.replace(/\/[^/]*$/, '/nope')}\n`)
  await expect(w.request('explorer.listObjects', { ref })).rejects.toThrow()
  expect(JSON.stringify(host.data())).not.toContain(container.getPassword())
  await w.deactivate()
}, 120_000)
