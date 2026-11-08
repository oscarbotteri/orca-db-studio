// Connection registry (storage:own), passwords (secrets:own), SQLite files, worktree connections from .env. C1-C4
import { basename, dirname, isAbsolute, normalize } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { loadDriver } from '../drivers/registry'
import type { ConnectionConfig, SchemaTree, Session, SqlDialect } from '../drivers/types'
import type {
  CellValue,
  ConnectionEntry,
  ConnectionForm,
  ConnectionList,
  QueryResult,
  SavedConnection,
} from '../protocol'
import { createQueryEngine, type RunOptions } from './query-engine'
import {
  configOf,
  deleteServer,
  findServer,
  getServer,
  listServers,
  passwordOf,
  saveServer,
} from './saved-connections'

/** The registry keeps a SQLite file's path and nothing else. */
const SQLITE_FILES_KEY = 'sqlite-files'

export interface Connections {
  list(): Promise<ConnectionList>
  addSqliteFile(path: string): Promise<ConnectionEntry>
  removeSqliteFile(path: string): Promise<void>
  saveServer(input: ServerInput): Promise<ConnectionEntry>
  testServer(input: ServerInput): Promise<void>
  getServer(ref: string): Promise<SavedConnection>
  deleteServer(ref: string): Promise<void>
  listObjects(ref: string): Promise<SchemaTree>
  dialect(ref: string): Promise<SqlDialect>
  quoteIdent(ref: string, name: string): Promise<string>
  runQuery(ref: string, sql: string, options: RunOptions): Promise<QueryResult>
  cancelQuery(documentId: string): Promise<void>
  queryCell(documentId: string, row: number, column: number): CellValue
  releaseQuery(documentId: string): void
  closeAll(): Promise<void>
}

interface ServerInput {
  ref?: string
  form: ConnectionForm
  password?: string
}

function sqliteEntry(path: string): ConnectionEntry {
  // The folder, not the whole path: a narrow panel would cut the file name off.
  return { ref: path, name: basename(path), detail: basename(dirname(path)) }
}

async function connect(config: ConnectionConfig, secret?: string): Promise<Session> {
  const driver = await loadDriver(config.engine)
  return driver.connect(config, secret)
}

async function storedSqliteFiles(orca: OrcaWorkerApi): Promise<string[]> {
  const stored = await orca.storage.get(SQLITE_FILES_KEY)
  return Array.isArray(stored) ? stored.filter((p) => typeof p === 'string') : []
}

async function addSqliteFile(orca: OrcaWorkerApi, input: string): Promise<ConnectionEntry> {
  if (!isAbsolute(input)) throw new Error('Enter an absolute path to a SQLite file')
  const path = normalize(input)
  // Connecting proves the file is there and is a SQLite database.
  await (await connect({ engine: 'sqlite', path })).close()
  const files = await storedSqliteFiles(orca)
  if (!files.includes(path)) {
    await orca.storage.set(SQLITE_FILES_KEY, [...files, path])
    orca.panels.post('connections.changed', {})
  }
  return sqliteEntry(path)
}

async function removeSqliteFile(orca: OrcaWorkerApi, path: string): Promise<void> {
  const files = await storedSqliteFiles(orca)
  if (!files.includes(path)) throw new Error(`No connection ${path}`)
  await orca.storage.set(
    SQLITE_FILES_KEY,
    files.filter((p) => p !== path),
  )
  orca.panels.post('connections.changed', {})
}

async function configFor(orca: OrcaWorkerApi, ref: string): Promise<ConnectionConfig> {
  if ((await storedSqliteFiles(orca)).includes(ref)) return { engine: 'sqlite', path: ref }
  const server = await findServer(orca, ref)
  if (server) return server
  throw new Error(`No connection ${ref}`)
}

export function createConnections(orca: OrcaWorkerApi): Connections {
  const sessions = new Map<string, Promise<Session>>()
  const engine = createQueryEngine()

  async function openSession(ref: string, config: ConnectionConfig): Promise<Session> {
    return connect(config, config.engine === 'sqlite' ? undefined : await passwordOf(orca, ref))
  }

  function forget(ref: string): void {
    const open = sessions.get(ref)
    sessions.delete(ref)
    void open?.then((s) => s.close()).catch(() => undefined)
  }

  function session(ref: string, config: ConnectionConfig): Promise<Session> {
    let opened = sessions.get(ref)
    if (!opened) {
      opened = openSession(ref, config)
      sessions.set(ref, opened)
      // A failed connect is not cached: the next request tries again.
      opened.catch(() => {
        if (sessions.get(ref) === opened) sessions.delete(ref)
      })
    }
    return opened
  }

  return {
    async list() {
      return {
        sqliteFiles: (await storedSqliteFiles(orca)).map(sqliteEntry),
        servers: await listServers(orca),
      }
    },
    async saveServer(input) {
      const entry = await saveServer(orca, input)
      // An edit may have changed where it points or its password.
      forget(entry.ref)
      return entry
    },
    async testServer({ ref, form, password }) {
      const secret = password || (ref ? await passwordOf(orca, ref) : undefined)
      await (await connect(configOf(form), secret)).close()
    },
    getServer(ref) {
      return getServer(orca, ref)
    },
    async deleteServer(ref) {
      await deleteServer(orca, ref)
      forget(ref)
    },
    addSqliteFile(path) {
      return addSqliteFile(orca, path)
    },
    async removeSqliteFile(path) {
      await removeSqliteFile(orca, path)
      forget(path)
    },
    async listObjects(ref) {
      return (await session(ref, await configFor(orca, ref))).listObjects()
    },
    async dialect(ref) {
      return (await session(ref, await configFor(orca, ref))).dialect
    },
    async quoteIdent(ref, name) {
      return (await session(ref, await configFor(orca, ref))).quoteIdent(name)
    },
    async runQuery(ref, sql, options) {
      return engine.run(await session(ref, await configFor(orca, ref)), sql, options)
    },
    cancelQuery(documentId) {
      return engine.cancel(documentId)
    },
    queryCell(documentId, row, column) {
      return engine.cell(documentId, row, column)
    },
    releaseQuery(documentId) {
      engine.release(documentId)
    },
    async closeAll() {
      const open = [...sessions.values()]
      sessions.clear()
      await Promise.allSettled(open.map(async (s) => (await s).close()))
    },
  }
}
