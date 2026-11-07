// Connection registry (storage:own), passwords (secrets:own), SQLite files, worktree connections from .env. C1-C4
import { basename, isAbsolute, normalize } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { loadDriver } from '../drivers/registry'
import type { ConnectionConfig, SchemaTree, Session } from '../drivers/types'
import type { ConnectionEntry, ConnectionList } from '../protocol'

/** The registry keeps a SQLite file's path and nothing else. */
const SQLITE_FILES_KEY = 'sqlite-files'

export interface Connections {
  list(): Promise<ConnectionList>
  addSqliteFile(path: string): Promise<ConnectionEntry>
  listObjects(ref: string): Promise<SchemaTree>
  closeAll(): Promise<void>
}

function sqliteEntry(path: string): ConnectionEntry {
  return { ref: path, name: basename(path), detail: path }
}

async function connect(config: ConnectionConfig): Promise<Session> {
  const driver = await loadDriver(config.engine)
  return driver.connect(config, undefined)
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

async function configFor(orca: OrcaWorkerApi, ref: string): Promise<ConnectionConfig> {
  if ((await storedSqliteFiles(orca)).includes(ref)) return { engine: 'sqlite', path: ref }
  throw new Error(`No connection ${ref}`)
}

export function createConnections(orca: OrcaWorkerApi): Connections {
  const sessions = new Map<string, Promise<Session>>()

  function session(ref: string, config: ConnectionConfig): Promise<Session> {
    let opened = sessions.get(ref)
    if (!opened) {
      opened = connect(config)
      sessions.set(ref, opened)
      // A failed connect is not cached: the next request tries again.
      opened.catch(() => sessions.delete(ref))
    }
    return opened
  }

  return {
    async list() {
      return { sqliteFiles: (await storedSqliteFiles(orca)).map(sqliteEntry) }
    },
    addSqliteFile(path) {
      return addSqliteFile(orca, path)
    },
    async listObjects(ref) {
      return (await session(ref, await configFor(orca, ref))).listObjects()
    },
    async closeAll() {
      const open = [...sessions.values()]
      sessions.clear()
      await Promise.allSettled(open.map(async (s) => (await s).close()))
    },
  }
}
