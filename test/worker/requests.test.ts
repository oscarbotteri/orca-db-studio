// Seam B: the worker driven only through its protocol requests, on a faked Orca host and real
// SQLite files in temporary workspaces.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mockHost, mountWorker, type TestWorker } from 'orca/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CHOOSER_REQUEST_KEY } from '../../src/protocol'
import * as worker from '../../src/worker/index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'db-studio-worker-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createDatabase(path: string, sql = 'CREATE TABLE t (id INTEGER)'): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(sql)
  db.close()
  return path
}

interface Workspace {
  name: string
  hostId?: string
}

async function start(workspaces: Workspace[] = []): Promise<TestWorker> {
  const listed = workspaces.map((w) => ({
    id: `id-${w.name}`,
    kind: 'worktree' as const,
    name: w.name,
    path: join(root, w.name),
    branch: 'main',
    hostId: w.hostId ?? null,
  }))
  const host = mockHost({
    results: { 'workspace.list': { workspaces: listed, truncated: false } },
  })
  return mountWorker(worker, { host })
}

describe('sqlite.findFiles', () => {
  test('lists SQLite files in local workspaces, skipping node_modules and .git', async () => {
    await createDatabase(join(root, 'api', 'app.db'))
    await createDatabase(join(root, 'api', 'data', 'cache.sqlite3'))
    await createDatabase(join(root, 'api', 'node_modules', 'pkg', 'fixture.db'))
    await createDatabase(join(root, 'api', '.git', 'objects.db'))
    await writeFile(join(root, 'api', 'notes.txt'), 'not a database')
    await createDatabase(join(root, 'web', 'dev.db3'))
    await createDatabase(join(root, 'web', 'legacy.sqlite'))
    await createDatabase(join(root, 'remote', 'far.db'))
    const w = await start([{ name: 'api' }, { name: 'web' }, { name: 'remote', hostId: 'ssh' }])

    const { files } = await w.request('sqlite.findFiles')

    expect(files).toEqual([
      { path: join(root, 'api', 'app.db'), relativePath: 'app.db', workspaceName: 'api' },
      {
        path: join(root, 'api', 'data', 'cache.sqlite3'),
        relativePath: join('data', 'cache.sqlite3'),
        workspaceName: 'api',
      },
      { path: join(root, 'web', 'dev.db3'), relativePath: 'dev.db3', workspaceName: 'web' },
      {
        path: join(root, 'web', 'legacy.sqlite'),
        relativePath: 'legacy.sqlite',
        workspaceName: 'web',
      },
    ])
  })
})

describe('sqlite.add', () => {
  test('adds a SQLite file by absolute path and lists it as a connection', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    const added = await w.request('sqlite.add', { path })

    expect(added).toEqual({ ref: path, name: 'shop.db', detail: basename(root) })
    expect(await w.request('connections.list')).toEqual({ sqliteFiles: [added] })
    expect(w.posts).toContainEqual({ event: 'connections.changed', payload: {} })
  })

  test('keeps a file added twice once', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    await w.request('sqlite.add', { path })
    await w.request('sqlite.add', { path })

    expect((await w.request('connections.list')).sqliteFiles).toHaveLength(1)
  })

  test('refuses a file that is not a SQLite database with a clear error', async () => {
    const path = join(root, 'notes.db')
    await writeFile(path, 'plain text')
    const w = await start()

    await expect(w.request('sqlite.add', { path })).rejects.toThrow(
      `${path} is not a SQLite database`,
    )
    expect(await w.request('connections.list')).toEqual({ sqliteFiles: [] })
  })

  test('refuses a relative path', async () => {
    const w = await start()

    await expect(w.request('sqlite.add', { path: 'data/app.db' })).rejects.toThrow(
      'Enter an absolute path to a SQLite file',
    )
  })

  test('remembers added files across worker restarts, storing only the path', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const host = mockHost()
    const first = await mountWorker(worker, { host })
    await first.request('sqlite.add', { path })
    await first.deactivate()

    const second = await mountWorker(worker, { host })

    expect((await second.request('connections.list')).sqliteFiles.map((c) => c.ref)).toEqual([path])
    expect(Object.values(host.data().storage)).toContainEqual([path])
  })
})

describe('explorer.listObjects', () => {
  test("lists an added SQLite file's tables and views by schema", async () => {
    const path = await createDatabase(
      join(root, 'shop.db'),
      'CREATE TABLE orders (id INTEGER); CREATE TABLE customers (id INTEGER); CREATE VIEW recent AS SELECT id FROM orders',
    )
    const w = await start()
    const { ref } = await w.request('sqlite.add', { path })

    expect(await w.request('explorer.listObjects', { ref })).toEqual({
      schemas: [
        {
          name: 'main',
          objects: [
            { name: 'customers', kind: 'table' },
            { name: 'orders', kind: 'table' },
            { name: 'recent', kind: 'view' },
          ],
        },
      ],
    })
    await w.deactivate()
  })

  test('refuses a connection that was never added', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    await expect(w.request('explorer.listObjects', { ref: path })).rejects.toThrow(
      `No connection ${path}`,
    )
  })
})

describe('Open SQLite File command', () => {
  test('asks the panel to show the SQLite file chooser', async () => {
    const host = mockHost()
    const w = await mountWorker(worker, { host })

    const message = await w.command('db-studio.openSqliteFile')

    expect(message).toBe('Choose a SQLite file in the DB Studio panel.')
    expect(host.data().storage[CHOOSER_REQUEST_KEY]).toBe(true)
    expect(w.posts).toContainEqual({ event: 'sqlite.chooserRequested', payload: {} })
  })
})
