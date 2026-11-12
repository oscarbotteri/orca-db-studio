// Seam B: the worker driven only through its protocol requests, on a faked Orca host and real
// SQLite files in temporary workspaces.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hostError, mockHost, mountWorker, type TestWorker } from 'orca/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { NEW_QUERY_REQUEST_KEY, SQLITE_FORM_REQUEST_KEY } from '../../src/protocol'
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
    hostId: w.hostId ?? 'local',
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

function sqliteForm(path: string, name = basename(path)) {
  return { name, engine: 'sqlite' as const, path }
}

async function saveSqlite(w: TestWorker, path: string, name?: string): Promise<string> {
  return (await w.request('connection.save', { form: sqliteForm(path, name) })).ref
}

describe('saving a SQLite file', () => {
  test('saves a SQLite file by absolute path and lists it as a saved connection', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    const saved = await w.request('connection.save', { form: sqliteForm(path, 'Shop') })

    expect(saved).toMatchObject({ name: 'Shop', detail: basename(root), origin: 'saved' })
    expect(await w.request('connections.list')).toEqual({ saved: [saved], worktrees: [] })
    expect(w.posts).toContainEqual({ event: 'connections.changed', payload: {} })
  })

  test('refuses a file that is already saved, naming the connection', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()
    await saveSqlite(w, path, 'Shop')

    await expect(saveSqlite(w, path, 'Again')).rejects.toThrow('This file is already saved as Shop')
    expect((await w.request('connections.list')).saved).toHaveLength(1)
  })

  test('refuses a file that is not a SQLite database with a clear error', async () => {
    const path = join(root, 'notes.db')
    await writeFile(path, 'plain text')
    const w = await start()

    await expect(saveSqlite(w, path)).rejects.toThrow(`${path} is not a SQLite database`)
    expect(await w.request('connections.list')).toEqual({ saved: [], worktrees: [] })
  })

  test('refuses a relative path', async () => {
    const w = await start()

    await expect(saveSqlite(w, 'data/app.db')).rejects.toThrow(
      'Enter an absolute path to a SQLite file',
    )
  })

  test('names a file without a name after the file', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    const saved = await w.request('connection.save', { form: sqliteForm(path, ' ') })

    expect(saved.name).toBe('shop.db')
  })

  test('a server turned into a SQLite file drops its password', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const host = mockHost()
    const w = await mountWorker(worker, { host })
    const { ref } = await w.request('connection.save', { form: PG_FORM, password: 'pw' })

    await w.request('connection.save', { ref, form: sqliteForm(path) })

    expect(host.data().secrets).toEqual({})
    expect((await w.request('connection.get', { ref })).hasPassword).toBe(false)
    await w.deactivate()
  })

  test('remembers saved files across worker restarts, with no password', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const host = mockHost()
    const first = await mountWorker(worker, { host })
    const ref = await first.request('connection.save', {
      form: sqliteForm(path, 'Shop'),
      password: 'ignored',
    })
    await first.deactivate()

    const second = await mountWorker(worker, { host })

    expect((await second.request('connections.list')).saved).toEqual([ref])
    expect(await second.request('connection.get', { ref: ref.ref })).toEqual({
      form: sqliteForm(path, 'Shop'),
      hasPassword: false,
    })
    expect(host.data().secrets).toEqual({})
    await second.deactivate()
  })

  test('connection.test opens the file and closes it again', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    await w.request('connection.test', { form: sqliteForm(path) })
    await expect(
      w.request('connection.test', { form: sqliteForm(join(root, 'missing.db')) }),
    ).rejects.toThrow()
    expect((await w.request('connections.list')).saved).toEqual([])
  })

  test('an edit renames the file and points it at another, keeping its ref', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const moved = await createDatabase(
      join(root, 'moved', 'shop.db'),
      'CREATE TABLE moved (id INTEGER)',
    )
    const w = await start()
    const ref = await saveSqlite(w, path)
    await w.request('explorer.listObjects', { ref })

    await w.request('connection.save', { ref, form: sqliteForm(moved, 'Moved') })

    expect((await w.request('connections.list')).saved).toEqual([
      { ref, name: 'Moved', detail: 'moved', origin: 'saved' },
    ])
    const tree = await w.request('explorer.listObjects', { ref })
    expect(tree.schemas[0]?.objects.map((o) => o.name)).toEqual(['moved'])
    await w.deactivate()
  })

  test('lists saved connections by name, servers and SQLite files together', async () => {
    const w = await start()
    await saveSqlite(w, await createDatabase(join(root, 'b.db')), 'beta')
    await w.request('connection.save', { form: { ...PG_FORM, name: 'Gamma' } })
    await saveSqlite(w, await createDatabase(join(root, 'a.db')), 'Alpha')

    const { saved } = await w.request('connections.list')

    expect(saved.map((c) => c.name)).toEqual(['Alpha', 'beta', 'Gamma'])
  })
})

describe('deleting a SQLite connection', () => {
  test('forgets it, leaves the file on disk and notifies the panel', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const keep = await createDatabase(join(root, 'keep.db'))
    const w = await start()
    const ref = await saveSqlite(w, path)
    const kept = await saveSqlite(w, keep)
    const before = w.posts.length

    await w.request('connection.delete', { ref })

    expect((await w.request('connections.list')).saved.map((c) => c.ref)).toEqual([kept])
    expect(await readFile(path)).toBeInstanceOf(Buffer)
    expect(w.posts.slice(before)).toContainEqual({ event: 'connections.changed', payload: {} })
    await w.deactivate()
  })

  test('closes the open session: a query on it fails like any unknown connection', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()
    const ref = await saveSqlite(w, path)
    await w.request('query.run', { ref, sql: 'SELECT 1', documentId: 'd1' })

    await w.request('connection.delete', { ref })

    await expect(
      w.request('query.run', { ref, sql: 'SELECT 1', documentId: 'd1' }),
    ).rejects.toThrow(`No connection ${ref}`)
    await w.deactivate()
  })

  test('a deleted file can be saved again and is still found in its workspace', async () => {
    const path = await createDatabase(join(root, 'api', 'app.db'))
    const w = await start([{ name: 'api' }])
    await w.request('connection.delete', { ref: await saveSqlite(w, path) })

    const { files } = await w.request('sqlite.findFiles')
    await saveSqlite(w, path)

    expect(files.map((f) => f.path)).toEqual([path])
    expect((await w.request('connections.list')).saved).toHaveLength(1)
    await w.deactivate()
  })
})

describe('SQLite files saved by v0.2.0', () => {
  test('are listed by file name and keep their path as ref, so their documents still run', async () => {
    const path = await createDatabase(join(root, 'data', 'shop.db'))
    const host = mockHost({ storage: { 'sqlite-files': [path] } })
    const w = await mountWorker(worker, { host })

    expect((await w.request('connections.list')).saved).toEqual([
      { ref: path, name: 'shop.db', detail: 'data', origin: 'saved' },
    ])
    expect(
      await w.request('query.run', { ref: path, sql: 'SELECT 1 AS one', documentId: 'd1' }),
    ).toMatchObject({ rows: [[1]] })
    expect(host.data().storage['sqlite-files']).toBeUndefined()
    await w.deactivate()
  })

  test('join the connections already saved without duplicating any', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const host = mockHost({ storage: { 'sqlite-files': [path] } })
    const first = await mountWorker(worker, { host })
    await first.request('connection.save', { form: PG_FORM })
    await first.deactivate()

    const second = await mountWorker(worker, { host })

    expect((await second.request('connections.list')).saved.map((c) => c.name)).toEqual([
      'Shop DB',
      'shop.db',
    ])
    await second.deactivate()
  })

  test('a connection saved while they are being migrated is kept', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const host = mockHost({ storage: { 'sqlite-files': [path] } })
    const w = await mountWorker(worker, { host })

    await Promise.all([
      w.request('connections.list'),
      w.request('connection.save', { form: PG_FORM }),
      w.request('connections.list'),
    ])

    expect((await w.request('connections.list')).saved.map((c) => c.name)).toEqual([
      'Shop DB',
      'shop.db',
    ])
    await w.deactivate()
  })

  test('two connections saved at once are both kept', async () => {
    const w = await mountWorker(worker, { host: mockHost() })

    await Promise.all([
      w.request('connection.save', { form: { ...PG_FORM, name: 'One' } }),
      w.request('connection.save', { form: { ...PG_FORM, name: 'Two' } }),
    ])

    expect((await w.request('connections.list')).saved.map((c) => c.name)).toEqual(['One', 'Two'])
    await w.deactivate()
  })
})

describe('explorer.listObjects', () => {
  test("lists an added SQLite file's tables and views by schema", async () => {
    const path = await createDatabase(
      join(root, 'shop.db'),
      'CREATE TABLE orders (id INTEGER); CREATE TABLE customers (id INTEGER); CREATE VIEW recent AS SELECT id FROM orders',
    )
    const w = await start()
    const ref = await saveSqlite(w, path)

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

describe('editor.schema', () => {
  test("answers a SQLite file's tables and views with their columns", async () => {
    const path = await createDatabase(
      join(root, 'shop.db'),
      'CREATE TABLE orders (id INTEGER, total REAL); CREATE VIEW recent AS SELECT id FROM orders',
    )
    const w = await start()
    const ref = await saveSqlite(w, path)

    expect(await w.request('editor.schema', { ref })).toEqual({
      defaultSchema: 'main',
      tables: [
        { schema: 'main', name: 'orders', columns: ['id', 'total'] },
        { schema: 'main', name: 'recent', columns: ['id'] },
      ],
    })
    await w.deactivate()
  })

  test('keeps every table but drops the columns that do not fit one answer', async () => {
    // About 1 MB of names: more than one worker answer may carry.
    const columns = Array.from(
      { length: 100 },
      (_, i) => `${'c'.repeat(95)}${String(i).padStart(3, '0')} INTEGER`,
    )
    const tables = Array.from(
      { length: 100 },
      (_, i) => `CREATE TABLE t${String(i).padStart(3, '0')} (${columns.join(', ')})`,
    )
    const path = await createDatabase(join(root, 'big.db'), tables.join('; '))
    const w = await start()
    const ref = await saveSqlite(w, path)

    const tree = await w.request('editor.schema', { ref })

    expect(tree.tables.map((t) => t.name)).toEqual(
      Array.from({ length: 100 }, (_, i) => `t${String(i).padStart(3, '0')}`),
    )
    expect(Buffer.byteLength(JSON.stringify(tree))).toBeLessThanOrEqual(900 * 1024)
    expect(tree.tables[0]?.columns).toHaveLength(100)
    expect(tree.tables.at(-1)?.columns).toEqual([])
    await w.deactivate()
  })

  test('refuses a connection that was never added', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    await expect(w.request('editor.schema', { ref: path })).rejects.toThrow(`No connection ${path}`)
  })
})

describe('Open SQLite File command', () => {
  test('asks the panel to open the connection form on SQLite', async () => {
    const host = mockHost()
    const w = await mountWorker(worker, { host })

    const message = await w.command('db-studio.openSqliteFile')

    expect(message).toBe('Add the SQLite file in the DB Studio panel.')
    expect(host.data().storage[SQLITE_FORM_REQUEST_KEY]).toBe(true)
    expect(w.posts).toContainEqual({ event: 'sqlite.formRequested', payload: {} })
  })
})

interface Focus {
  branch: string
  displayName: string
}

/** A host with real workspace folders, the focused one answering workspace.readContext. */
async function startWithFocus(
  names: string[],
  focus: Focus | null,
  settings = {},
  hostIds: Record<string, string | null> = {},
  displayNames: Record<string, string> = {},
) {
  const listed = names.map((name) => ({
    id: `id-${name}`,
    kind: 'worktree' as const,
    name: displayNames[name] ?? name,
    path: join(root, name),
    branch: 'main',
    hostId: name in hostIds ? hostIds[name] : 'local',
  }))
  for (const w of listed) await mkdir(w.path, { recursive: true })
  const host = mockHost({
    settings,
    results: {
      'workspace.list': { workspaces: listed, truncated: false },
      'workspace.readContext': focus && { ...focus, terminals: [] },
      'editor.open': { opened: true },
    },
  })
  return { host, worker: await mountWorker(worker, { host }) }
}

async function shopRef(w: TestWorker): Promise<string> {
  const path = await createDatabase(
    join(root, 'shop.db'),
    'CREATE TABLE orders (id INTEGER); INSERT INTO orders VALUES (1),(2),(3),(4),(5); CREATE TABLE "we""ird" (id INTEGER)',
  )
  return saveSqlite(w, path)
}

describe('table.open', () => {
  test('writes a query document into .db-studio/ of the focused workspace and opens it', async () => {
    const { host, worker: w } = await startWithFocus(['api', 'web'], {
      branch: 'main',
      displayName: 'web',
    })
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspaceName: 'web',
    })
    expect(await readFile(join(root, 'web', '.db-studio', 'orders.sql'), 'utf8')).toBe(
      `-- db-studio: connection=${ref}\nSELECT * FROM "main"."orders" LIMIT 100\n`,
    )
    expect(host.callsOf('editor.open')).toEqual([
      { workspaceId: 'id-web', path: '.db-studio/orders.sql' },
    ])
  })

  test('makes .db-studio/ ignore itself and never touches the repo .gitignore', async () => {
    const { worker: w } = await startWithFocus(['api'], { branch: 'main', displayName: 'api' })
    await writeFile(join(root, 'api', '.gitignore'), 'dist\n')
    const ref = await shopRef(w)

    await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(await readFile(join(root, 'api', '.db-studio', '.gitignore'), 'utf8')).toBe('*\n')
    expect(await readFile(join(root, 'api', '.gitignore'), 'utf8')).toBe('dist\n')
  })

  test('quotes table names and does not overwrite an earlier document', async () => {
    const { worker: w } = await startWithFocus(['api'], { branch: 'main', displayName: 'api' })
    const ref = await shopRef(w)

    await w.request('table.open', { ref, schema: 'main', table: 'orders' })
    const second = await w.request('table.open', { ref, schema: 'main', table: 'orders' })
    await w.request('table.open', { ref, schema: 'main', table: 'we"ird' })

    expect(second).toEqual({
      status: 'opened',
      path: '.db-studio/orders-2.sql',
      workspaceName: 'api',
    })
    expect(await readFile(join(root, 'api', '.db-studio', 'we_ird.sql'), 'utf8')).toContain(
      'SELECT * FROM "main"."we""ird" LIMIT 100',
    )
  })

  test('asks the panel to choose when none of several workspaces is focused', async () => {
    const { host, worker: w } = await startWithFocus(['api', 'web'], null)
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'choose-workspace',
      workspaces: [
        { id: 'id-api', name: 'api' },
        { id: 'id-web', name: 'web' },
      ],
    })
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('asks to choose between workspaces sharing the focused name and branch', async () => {
    const { host, worker: w } = await startWithFocus(
      ['a', 'b'],
      { branch: 'main', displayName: 'dup' },
      {},
      {},
      { a: 'dup', b: 'dup' },
    )
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'choose-workspace',
      workspaces: [
        { id: 'id-a', name: 'dup' },
        { id: 'id-b', name: 'dup' },
      ],
    })
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('opens in the only local workspace when none is focused', async () => {
    const { worker: w } = await startWithFocus(['api'], null)
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspaceName: 'api',
    })
  })

  test('uses the workspace the person chose', async () => {
    const { worker: w } = await startWithFocus(['api', 'web'], null)
    const ref = await shopRef(w)

    const result = await w.request('table.open', {
      ref,
      schema: 'main',
      table: 'orders',
      workspaceId: 'id-api',
    })

    expect(result).toEqual({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspaceName: 'api',
    })
    expect(await readFile(join(root, 'api', '.db-studio', 'orders.sql'), 'utf8')).toContain(
      'LIMIT 100',
    )
  })

  test('fails clearly when no workspace is open', async () => {
    const { worker: w } = await startWithFocus([], null)
    const ref = await shopRef(w)

    await expect(w.request('table.open', { ref, schema: 'main', table: 'orders' })).rejects.toThrow(
      'DB Studio needs a local workspace',
    )
  })

  test('fails clearly when the only workspaces are on a remote host', async () => {
    const { host, worker: w } = await startWithFocus(['remote'], null, {}, { remote: 'ssh' })
    const ref = await shopRef(w)

    await expect(w.request('table.open', { ref, schema: 'main', table: 'orders' })).rejects.toThrow(
      'DB Studio needs a local workspace',
    )
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('opens in the local workspace when a remote one is also open', async () => {
    const { worker: w } = await startWithFocus(
      ['remote', 'api'],
      { branch: 'main', displayName: 'api' },
      {},
      { remote: 'ssh' },
    )
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspaceName: 'api',
    })
    expect(await readFile(join(root, 'api', '.db-studio', 'orders.sql'), 'utf8')).toContain(
      'LIMIT 100',
    )
  })

  test('treats a workspace without a host id as local', async () => {
    const { worker: w } = await startWithFocus(
      ['api'],
      { branch: 'main', displayName: 'api' },
      {},
      { api: null },
    )
    const ref = await shopRef(w)

    const result = await w.request('table.open', { ref, schema: 'main', table: 'orders' })

    expect(result).toEqual({
      status: 'opened',
      path: '.db-studio/orders.sql',
      workspaceName: 'api',
    })
  })

  test('refuses a connection that was never added', async () => {
    const { worker: w } = await startWithFocus(['api'], { branch: 'main', displayName: 'api' })

    await expect(
      w.request('table.open', { ref: '/nope.db', schema: 'main', table: 'orders' }),
    ).rejects.toThrow('No connection /nope.db')
  })
})

describe('New Query command', () => {
  test('opens an empty query document in the focused workspace', async () => {
    const { host, worker: w } = await startWithFocus(['api', 'web'], {
      branch: 'main',
      displayName: 'web',
    })

    const message = await w.command('db-studio.newQuery')

    expect(message).toBe('Opened .db-studio/query.sql in web.')
    expect(await readFile(join(root, 'web', '.db-studio', 'query.sql'), 'utf8')).toBe('')
    expect(host.callsOf('editor.open')).toEqual([
      { workspaceId: 'id-web', path: '.db-studio/query.sql' },
    ])
  })

  test('asks the panel to choose when the focused workspace is ambiguous', async () => {
    const { host, worker: w } = await startWithFocus(
      ['a', 'b'],
      { branch: 'main', displayName: 'dup' },
      {},
      {},
      { a: 'dup', b: 'dup' },
    )

    const message = await w.command('db-studio.newQuery')

    expect(message).toBe('Choose the workspace for the new query in the DB Studio panel.')
    expect(host.data().storage[NEW_QUERY_REQUEST_KEY]).toEqual([
      { id: 'id-a', name: 'dup' },
      { id: 'id-b', name: 'dup' },
    ])
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('names a second query query-2.sql instead of overwriting the first', async () => {
    const { host, worker: w } = await startWithFocus(['api'], {
      branch: 'main',
      displayName: 'api',
    })
    await w.command('db-studio.newQuery')
    await writeFile(join(root, 'api', '.db-studio', 'query.sql'), 'SELECT 1\n')

    const message = await w.command('db-studio.newQuery')

    expect(message).toBe('Opened .db-studio/query-2.sql in api.')
    expect(await readFile(join(root, 'api', '.db-studio', 'query.sql'), 'utf8')).toBe('SELECT 1\n')
    expect(await readFile(join(root, 'api', '.db-studio', 'query-2.sql'), 'utf8')).toBe('')
    expect(host.callsOf('editor.open')).toEqual([
      { workspaceId: 'id-api', path: '.db-studio/query.sql' },
      { workspaceId: 'id-api', path: '.db-studio/query-2.sql' },
    ])
  })

  test('makes .db-studio/ ignore itself and never touches the repo .gitignore', async () => {
    const { worker: w } = await startWithFocus(['api'], { branch: 'main', displayName: 'api' })
    await writeFile(join(root, 'api', '.gitignore'), 'dist\n')

    await w.command('db-studio.newQuery')

    expect(await readFile(join(root, 'api', '.db-studio', '.gitignore'), 'utf8')).toBe('*\n')
    expect(await readFile(join(root, 'api', '.gitignore'), 'utf8')).toBe('dist\n')
  })

  test('asks the panel to choose when none of several workspaces is focused', async () => {
    const { host, worker: w } = await startWithFocus(['api', 'web'], null)

    const message = await w.command('db-studio.newQuery')

    expect(message).toBe('Choose the workspace for the new query in the DB Studio panel.')
    expect(host.data().storage[NEW_QUERY_REQUEST_KEY]).toEqual([
      { id: 'id-api', name: 'api' },
      { id: 'id-web', name: 'web' },
    ])
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('opens in the only local workspace when none is focused', async () => {
    const { host, worker: w } = await startWithFocus(['api'], null)

    const message = await w.command('db-studio.newQuery')

    expect(message).toBe('Opened .db-studio/query.sql in api.')
    expect(host.data().storage[NEW_QUERY_REQUEST_KEY]).toBeUndefined()
    expect(host.callsOf('editor.open')).toEqual([
      { workspaceId: 'id-api', path: '.db-studio/query.sql' },
    ])
  })

  test('creates the query in the workspace the person chose', async () => {
    const { worker: w } = await startWithFocus(['api', 'web'], null)

    const result = await w.request('query.new', { workspaceId: 'id-api' })

    expect(result).toEqual({ status: 'opened', path: '.db-studio/query.sql', workspaceName: 'api' })
    expect(await readFile(join(root, 'api', '.db-studio', 'query.sql'), 'utf8')).toBe('')
  })

  test('refuses a chosen workspace that has since closed', async () => {
    const { host, worker: w } = await startWithFocus(['api', 'web'], null)

    await expect(w.request('query.new', { workspaceId: 'id-gone' })).rejects.toThrow(
      'That workspace is no longer open',
    )
    expect(host.callsOf('editor.open')).toEqual([])
  })

  test('fails clearly when no local workspace is open', async () => {
    const { worker: w } = await startWithFocus(['remote'], null, {}, { remote: 'ssh' })

    await expect(w.command('db-studio.newQuery')).rejects.toThrow(
      'DB Studio needs a local workspace',
    )
  })
})

describe('query.run', () => {
  async function runner(settings = {}) {
    const { worker: w } = await startWithFocus([], null, settings)
    return { w, ref: await shopRef(w) }
  }

  test('returns the columns and rows of a statement', async () => {
    const { w, ref } = await runner()

    const result = await w.request('query.run', {
      ref,
      sql: 'SELECT id FROM orders WHERE id < 3 ORDER BY id',
      documentId: 'd1',
    })

    expect(result).toEqual({
      columns: ['id'],
      rows: [[1], [2]],
      truncated: false,
    })
  })

  test('cuts a statement at the row limit and says so', async () => {
    const { w, ref } = await runner({ rowLimit: 3 })

    const result = await w.request('query.run', {
      ref,
      sql: 'SELECT id FROM orders',
      documentId: 'd1',
    })

    expect(result.rows).toEqual([[1], [2], [3]])
    expect(result.truncated).toBe(true)
  })

  test('does not report a cut-off when the rows fit exactly', async () => {
    const { w, ref } = await runner({ rowLimit: 5 })

    const result = await w.request('query.run', {
      ref,
      sql: 'SELECT id FROM orders',
      documentId: 'd1',
    })

    expect(result.rows).toHaveLength(5)
    expect(result.truncated).toBe(false)
  })

  test('shows the database error for a failing statement', async () => {
    const { w, ref } = await runner()

    await expect(
      w.request('query.run', { ref, sql: 'SELECT * FROM missing', documentId: 'd1' }),
    ).rejects.toThrow(/no such table: missing/)
  })

  test('runs the next statement after a failure on the same connection', async () => {
    const { w, ref } = await runner()
    await expect(
      w.request('query.run', { ref, sql: 'SELEC 1', documentId: 'd1' }),
    ).rejects.toThrow()

    const result = await w.request('query.run', { ref, sql: 'SELECT 1 AS one', documentId: 'd1' })

    expect(result.rows).toEqual([[1]])
  })
})

describe('connection.info', () => {
  test("names the connection's SQL dialect for the editor", async () => {
    const { worker: w } = await startWithFocus([], null)
    const ref = await shopRef(w)

    expect(await w.request('connection.info', { ref })).toEqual({ dialect: 'sqlite' })
  })
})

describe('query.run result ceiling', () => {
  test('never returns more than 5000 rows, whatever rowLimit says', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 100000 })
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000) SELECT i FROM n',
      documentId: 'd1',
    })

    expect(result.rows).toHaveLength(5000)
    expect(result.truncated).toBe(true)
  })
})

describe('query.run answer size', () => {
  test('stops before the answer outgrows what the host accepts, and says so', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 5000 })
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000) SELECT i, printf('%.2000c', 'x') AS pad FROM n",
      documentId: 'd1',
    })

    expect(result.truncated).toBe(true)
    expect(result.rows.length).toBeLessThan(3000)
    expect(JSON.stringify(result).length).toBeLessThan(900 * 1024)
  })
})

const PG_FORM = {
  name: 'Shop DB',
  engine: 'postgres' as const,
  host: 'db.internal',
  port: 5432,
  database: 'shop',
  user: 'app',
}

describe('connection.save', () => {
  test('lists a saved connection, keeping the password in secrets and out of storage', async () => {
    const host = mockHost()
    const w = await mountWorker(worker, { host })

    const saved = await w.request('connection.save', { form: PG_FORM, password: 's3cret-pw' })

    expect(saved).toMatchObject({ name: 'Shop DB', detail: 'app@db.internal:5432/shop' })
    expect((await w.request('connections.list')).saved).toEqual([saved])
    expect(w.posts).toContainEqual({ event: 'connections.changed', payload: {} })
    expect(JSON.stringify(host.data().storage)).not.toContain('s3cret-pw')
    expect(Object.values(host.data().secrets)).toEqual(['s3cret-pw'])
  })
})

describe('connection.save without a secrets store', () => {
  test('refuses a password with a clear error and stores nothing', async () => {
    const host = mockHost({ results: { 'secrets.protection': { status: 'unavailable' } } })
    const w = await mountWorker(worker, { host })

    await expect(
      w.request('connection.save', { form: PG_FORM, password: 's3cret-pw' }),
    ).rejects.toThrow(/secrets store is unavailable/)

    expect(host.data().storage).toEqual({})
    expect(host.data().secrets).toEqual({})
    expect((await w.request('connections.list')).saved).toEqual([])
  })

  test('still saves a connection that has no password', async () => {
    const host = mockHost({ results: { 'secrets.protection': { status: 'unavailable' } } })
    const w = await mountWorker(worker, { host })

    await w.request('connection.save', { form: PG_FORM })

    expect((await w.request('connections.list')).saved).toHaveLength(1)
  })
})

describe('editing and deleting a connection', () => {
  test('edit keeps the stored password unless a new one is given', async () => {
    const host = mockHost()
    const w = await mountWorker(worker, { host })
    const { ref } = await w.request('connection.save', { form: PG_FORM, password: 'first-pw' })

    await w.request('connection.save', { ref, form: { ...PG_FORM, name: 'Renamed' } })
    expect(await w.request('connection.get', { ref })).toEqual({
      form: { ...PG_FORM, name: 'Renamed' },
      hasPassword: true,
    })
    expect(Object.values(host.data().secrets)).toEqual(['first-pw'])

    await w.request('connection.save', { ref, form: PG_FORM, password: 'second-pw' })
    expect(Object.values(host.data().secrets)).toEqual(['second-pw'])
    expect((await w.request('connections.list')).saved).toHaveLength(1)
  })

  test('delete removes the registry entry and the password', async () => {
    const host = mockHost()
    const w = await mountWorker(worker, { host })
    const { ref } = await w.request('connection.save', { form: PG_FORM, password: 'pw' })

    await w.request('connection.delete', { ref })

    expect((await w.request('connections.list')).saved).toEqual([])
    expect(host.data().secrets).toEqual({})
    await expect(w.request('connection.get', { ref })).rejects.toThrow(`No connection ${ref}`)
  })

  test('refuses an invalid form', async () => {
    const w = await mountWorker(worker, { host: mockHost() })

    await expect(w.request('connection.save', { form: { ...PG_FORM, host: ' ' } })).rejects.toThrow(
      'Enter a host',
    )
  })

  test('saves a MySQL connection', async () => {
    const w = await mountWorker(worker, { host: mockHost() })
    const form = { ...PG_FORM, engine: 'mysql' as const, port: 3306 }

    const { ref } = await w.request('connection.save', { form, password: 'pw' })

    expect((await w.request('connection.get', { ref })).form).toEqual(form)
  })
})

describe('connection.test', () => {
  test('reports why a server could not be reached', async () => {
    const w = await mountWorker(worker, { host: mockHost() })

    await expect(
      w.request('connection.test', { form: { ...PG_FORM, host: '127.0.0.1', port: 1 } }),
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('saved connection details', () => {
  test('stores trimmed values', async () => {
    const w = await mountWorker(worker, { host: mockHost() })

    const { ref } = await w.request('connection.save', {
      form: { ...PG_FORM, name: ' Shop DB ', host: ' db.internal ', user: ' app ' },
    })

    expect((await w.request('connection.get', { ref })).form).toEqual(PG_FORM)
  })

  test('delete still succeeds and notifies when the secrets store refuses to delete', async () => {
    const host = mockHost({
      results: {
        'secrets.delete': () => {
          throw hostError('action_failed', 'store unavailable')
        },
      },
    })
    const w = await mountWorker(worker, { host })
    const { ref } = await w.request('connection.save', { form: PG_FORM })

    await w.request('connection.delete', { ref })

    expect((await w.request('connections.list')).saved).toEqual([])
    expect(w.posts.filter((p) => p.event === 'connections.changed')).toHaveLength(2)
  })
})

describe('query.run own LIMIT', () => {
  const COUNTER =
    'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000) SELECT i FROM n'

  test('a statement with its own LIMIT skips the row limit', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 3 })
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: 'SELECT id FROM orders LIMIT 5',
      documentId: 'd1',
    })

    expect(result.rows).toHaveLength(5)
    expect(result.truncated).toBe(false)
  })

  test('still stops at the result ceiling and says so', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 3 })
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: `${COUNTER} LIMIT 6000`,
      documentId: 'd1',
    })

    expect(result.rows).toHaveLength(5000)
    expect(result.truncated).toBe(true)
  })

  test('a LIMIT inside a subquery or a string is not the statement’s own', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 3 })
    const ref = await shopRef(w)

    const subquery = await w.request('query.run', {
      ref,
      sql: 'SELECT id FROM (SELECT id FROM orders LIMIT 4)',
      documentId: 'd1',
    })
    const text = await w.request('query.run', {
      ref,
      sql: "SELECT id, 'x LIMIT 9' AS s FROM orders",
      documentId: 'd1',
    })

    expect(subquery.rows).toHaveLength(3)
    expect(text.rows).toHaveLength(3)
  })
})

describe('query.run values', () => {
  async function run(sql: string, setup?: string) {
    const { worker: w } = await startWithFocus([], null)
    const path = await createDatabase(join(root, 'values.db'), setup ?? 'CREATE TABLE t (id)')
    const ref = await saveSqlite(w, path)
    return w.request('query.run', { ref, sql, documentId: 'd1' })
  }

  test('shortens long text to 300 characters', async () => {
    const result = await run("SELECT printf('%.1000c', 'x') AS body, 'short' AS s")

    expect(result.rows).toEqual([['x'.repeat(300), 'short']])
  })

  test('shows binary values as a size placeholder', async () => {
    const result = await run("SELECT zeroblob(1229) AS big, x'0102' AS small")

    expect(result.rows).toEqual([['<blob 1.2 KB>', '<blob 2 B>']])
  })

  test('keeps integers beyond 2^53 exact as strings and small ones as numbers', async () => {
    const result = await run('SELECT 9007199254740993 AS big, 42 AS small, 1.5 AS real')

    expect(result.rows).toEqual([['9007199254740993', 42, 1.5]])
  })

  test('keeps every column when names repeat', async () => {
    const result = await run('SELECT 1 AS id, 2 AS id')

    expect(result.columns).toEqual(['id', 'id'])
    expect(result.rows).toEqual([[1, 2]])
  })

  test('shows the affected row count of a statement without rows', async () => {
    const result = await run(
      'UPDATE t SET id = 9',
      'CREATE TABLE t (id); INSERT INTO t VALUES (1),(2)',
    )

    expect(result).toEqual({ columns: [], rows: [], truncated: false, affectedRows: 2 })
  })
})

describe('query.run wire size and cuts', () => {
  test('counts the answer in UTF-8 bytes, which multibyte text outgrows', async () => {
    const { worker: w } = await startWithFocus([], null, { rowLimit: 5000 })
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000) SELECT replace(hex(zeroblob(150)), '00', '日本') AS t FROM n",
      documentId: 'd1',
    })

    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(900 * 1024)
  })

  test('does not cut a surrogate pair in half', async () => {
    const { worker: w } = await startWithFocus([], null)
    const ref = await shopRef(w)

    const result = await w.request('query.run', {
      ref,
      sql: "SELECT printf('%.299c', 'x') || '😀😀' AS t",
      documentId: 'd1',
    })

    expect(result.rows).toEqual([['x'.repeat(299)]])
  })
})

describe('query.cell', () => {
  async function ranOnce(sql: string, documentId = 'd1') {
    const { worker: w } = await startWithFocus([], null)
    const ref = await shopRef(w)
    await w.request('query.run', { ref, sql, documentId })
    return { w, ref }
  }

  test('serves the full value of a shortened cell by row and column', async () => {
    const { w } = await ranOnce("SELECT 1 AS id, printf('%.1000c', 'x') AS body")

    expect(await w.request('query.cell', { documentId: 'd1', row: 0, column: 1 })).toEqual({
      text: 'x'.repeat(1000),
      cut: false,
    })
  })

  test('serves NULL as null and numbers as text', async () => {
    const { w } = await ranOnce('SELECT 42 AS n, NULL AS missing')

    expect(await w.request('query.cell', { documentId: 'd1', row: 0, column: 0 })).toEqual({
      text: '42',
      cut: false,
    })
    expect(await w.request('query.cell', { documentId: 'd1', row: 0, column: 1 })).toEqual({
      text: null,
      cut: false,
    })
  })

  test('cuts a value over 1 MiB and says so, keeping the answer under the host limit', async () => {
    const { w } = await ranOnce("SELECT replace(hex(zeroblob(1200000)), '00', 'é') AS big")

    const cell = await w.request('query.cell', { documentId: 'd1', row: 0, column: 0 })

    expect(cell.cut).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(cell))).toBeLessThanOrEqual(1024 * 1024)
    expect(cell.text?.length).toBeGreaterThan(400000)
  })

  test('keeps each document’s rows apart', async () => {
    const { w, ref } = await ranOnce("SELECT 'first' AS v", 'a')
    await w.request('query.run', { ref, sql: "SELECT 'second' AS v", documentId: 'b' })

    expect((await w.request('query.cell', { documentId: 'a', row: 0, column: 0 })).text).toBe(
      'first',
    )
    expect((await w.request('query.cell', { documentId: 'b', row: 0, column: 0 })).text).toBe(
      'second',
    )
  })

  test('a re-run replaces the rows the last run kept', async () => {
    const { w, ref } = await ranOnce('SELECT 1 AS a, 2 AS b')
    await w.request('query.run', { ref, sql: 'SELECT 9 AS a', documentId: 'd1' })

    await expect(w.request('query.cell', { documentId: 'd1', row: 0, column: 1 })).rejects.toThrow(
      /no such cell/i,
    )
    expect((await w.request('query.cell', { documentId: 'd1', row: 0, column: 0 })).text).toBe('9')
  })

  test('a failing re-run releases the rows too', async () => {
    const { w, ref } = await ranOnce('SELECT 1 AS a')
    await expect(
      w.request('query.run', { ref, sql: 'SELECT * FROM missing', documentId: 'd1' }),
    ).rejects.toThrow()

    await expect(w.request('query.cell', { documentId: 'd1', row: 0, column: 0 })).rejects.toThrow(
      /run the query again/i,
    )
  })

  test('query.release forgets the rows', async () => {
    const { w } = await ranOnce('SELECT 1 AS a')

    await w.request('query.release', { documentId: 'd1' })

    await expect(w.request('query.cell', { documentId: 'd1', row: 0, column: 0 })).rejects.toThrow(
      /run the query again/i,
    )
  })

  test('keeps the rows of the most recent documents only', async () => {
    const { w, ref } = await ranOnce('SELECT 1 AS a', 'doc-0')
    for (let i = 1; i <= 16; i++) {
      await w.request('query.run', { ref, sql: 'SELECT 1 AS a', documentId: `doc-${i}` })
    }

    await expect(
      w.request('query.cell', { documentId: 'doc-0', row: 0, column: 0 }),
    ).rejects.toThrow(/run the query again/i)
    expect((await w.request('query.cell', { documentId: 'doc-16', row: 0, column: 0 })).text).toBe(
      '1',
    )
  })

  test('refuses a position outside the result', async () => {
    const { w } = await ranOnce('SELECT 1 AS a')

    await expect(w.request('query.cell', { documentId: 'd1', row: 3, column: 0 })).rejects.toThrow(
      /no such cell/i,
    )
  })
})

describe('query.cancel and the query timeout', () => {
  // Counts to 60 million: seconds of work in SQLite before its one row.
  const SLOW =
    'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 60000000) SELECT count(*) FROM n'

  async function slowRunner(settings = {}) {
    const { worker: w } = await startWithFocus([], null, settings)
    return { w, ref: await shopRef(w) }
  }

  test('cancel stops a running query, and the next query on the same connection works', async () => {
    const { w, ref } = await slowRunner()
    const running = w.request('query.run', { ref, sql: SLOW, documentId: 'd1' })
    const failure = running.then(
      () => undefined,
      (error: Error) => error,
    )
    await new Promise((resolve) => setTimeout(resolve, 200))

    await w.request('query.cancel', { documentId: 'd1' })

    expect((await failure)?.message).toMatch(/cancel/i)
    const next = await w.request('query.run', { ref, sql: 'SELECT 1 AS one', documentId: 'd1' })
    expect(next.rows).toEqual([[1]])
  })

  test('cancel stops a document’s query even when another document queued on the same connection', async () => {
    const { w, ref } = await slowRunner()
    const first = w.request('query.run', { ref, sql: SLOW, documentId: 'a' }).then(
      () => undefined,
      (error: Error) => error,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = w.request('query.run', { ref, sql: 'SELECT 1', documentId: 'b' }).then(
      () => undefined,
      () => undefined,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    await w.request('query.cancel', { documentId: 'a' })

    expect((await first)?.message).toMatch(/cancel/i)
    await second
  })

  test('cancel with nothing running does nothing', async () => {
    const { w, ref } = await slowRunner()
    await w.request('query.run', { ref, sql: 'SELECT 1', documentId: 'd1' })

    await w.request('query.cancel', { documentId: 'd1' })

    const next = await w.request('query.run', { ref, sql: 'SELECT 2 AS two', documentId: 'd1' })
    expect(next.rows).toEqual([[2]])
  })

  test("cancelling one document also ends another document's query on the same SQLite connection", async () => {
    const { w, ref } = await slowRunner({ queryTimeoutSeconds: 5 })
    const outcome = (documentId: string) =>
      w.request('query.run', { ref, sql: SLOW, documentId }).then(
        () => 'finished',
        (error: Error) => error.message,
      )
    const first = outcome('d1')
    const second = outcome('d2')
    await new Promise((resolve) => setTimeout(resolve, 100))

    await w.request('query.cancel', { documentId: 'd1' })

    expect(await first).toBe('Query cancelled')
    expect(await second).toBe('Query cancelled')
  })

  test('a query over queryTimeoutSeconds ends with a timeout error, and the next one works', async () => {
    const { w, ref } = await slowRunner({ queryTimeoutSeconds: 1 })

    await expect(w.request('query.run', { ref, sql: SLOW, documentId: 'd1' })).rejects.toThrow(
      'Query timed out after 1 second',
    )

    const next = await w.request('query.run', { ref, sql: 'SELECT 1 AS one', documentId: 'd1' })
    expect(next.rows).toEqual([[1]])
  })

  test('a query within the timeout is left alone', async () => {
    const { w, ref } = await slowRunner({ queryTimeoutSeconds: 1 })

    const result = await w.request('query.run', { ref, sql: 'SELECT 1 AS one', documentId: 'd1' })

    expect(result.rows).toEqual([[1]])
  })

  test('the panel and other connections are answered while a query runs', async () => {
    const { w, ref } = await slowRunner({ queryTimeoutSeconds: 2 })
    const otherPath = await createDatabase(join(root, 'other.db'), 'CREATE TABLE u (id INTEGER)')
    const other = await saveSqlite(w, otherPath)
    const running = w.request('query.run', { ref, sql: SLOW, documentId: 'd1' })
    const settled = running.then(
      () => undefined,
      () => undefined,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const list = await w.request('connections.list')
    const tree = await w.request('explorer.listObjects', { ref: other })
    const result = await w.request('query.run', {
      ref: other,
      sql: 'SELECT 7 AS n',
      documentId: 'd2',
    })

    expect(list.saved).toHaveLength(2)
    expect(tree.schemas[0]?.objects.map((o) => o.name)).toEqual(['u'])
    expect(result.rows).toEqual([[7]])
    await settled
  })
})

describe('environment label', () => {
  const label = { environment: 'prod', tone: 'danger' } as const

  test('is saved with the connection, listed, and restored for editing', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()

    const saved = await w.request('connection.save', {
      form: { ...sqliteForm(path, 'Shop'), label },
    })

    expect(saved.label).toEqual(label)
    expect((await w.request('connections.list')).saved[0]?.label).toEqual(label)
    expect((await w.request('connection.get', { ref: saved.ref })).form).toMatchObject({ label })
  })

  test('a connection saved without one has none, and a label can be removed again', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()
    const { ref } = await w.request('connection.save', {
      form: { ...sqliteForm(path, 'Shop'), label },
    })

    const plain = await w.request('connection.save', { ref, form: sqliteForm(path, 'Shop') })

    expect(plain).not.toHaveProperty('label')
    expect((await w.request('connection.get', { ref })).form).not.toHaveProperty('label')
  })

  test('refuses an environment or tone it does not know', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()
    const bad = { environment: 'qa', tone: 'danger' } as never

    await expect(
      w.request('connection.save', { form: { ...sqliteForm(path), label: bad } }),
    ).rejects.toThrow('Choose an environment')
    await expect(
      w.request('connection.save', {
        form: { ...sqliteForm(path), label: { environment: 'prod', tone: 'pink' } as never },
      }),
    ).rejects.toThrow('Choose a color')
    expect((await w.request('connections.list')).saved).toEqual([])
  })

  test('a connection stored before labels existed lists with none', async () => {
    const path = await createDatabase(join(root, 'shop.db'))
    const w = await start()
    const { ref } = await w.request('connection.save', { form: sqliteForm(path, 'Shop') })

    expect((await w.request('connections.list')).saved).toEqual([
      { ref, name: 'Shop', detail: basename(root), origin: 'saved' },
    ])
  })
})
