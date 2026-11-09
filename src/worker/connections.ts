// Connection registry (storage:own), passwords (secrets:own), worktree connections from .env. C1-C4
import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionConfig, SchemaTree, Session, SqlDialect } from '../drivers'
import { loadDriver } from '../drivers'
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
  deleteSaved,
  findSaved,
  getSaved,
  listSaved,
  passwordOf,
  saveConnection,
} from './saved-connections'
import { listWorktreeConnections, parseWorktreeRef, resolveWorktree } from './worktree-connections'

export interface Connections {
  list(): Promise<ConnectionList>
  save(input: FormInput): Promise<ConnectionEntry>
  test(input: FormInput): Promise<void>
  get(ref: string): Promise<SavedConnection>
  delete(ref: string): Promise<void>
  listObjects(ref: string): Promise<SchemaTree>
  dialect(ref: string): Promise<SqlDialect>
  quoteIdent(ref: string, name: string): Promise<string>
  runQuery(ref: string, sql: string, options: RunOptions): Promise<QueryResult>
  cancelQuery(documentId: string): Promise<void>
  queryCell(documentId: string, row: number, column: number): CellValue
  releaseQuery(documentId: string): void
  closeAll(): Promise<void>
}

interface FormInput {
  ref?: string
  form: ConnectionForm
  password?: string
}

async function connect(config: ConnectionConfig, secret?: string): Promise<Session> {
  const driver = await loadDriver(config.engine)
  return driver.connect(config, secret)
}

/** What a ref points at now, and how to get its password. */
interface Target {
  config: ConnectionConfig
  password: () => Promise<string | undefined>
  /** Set for worktree connections, whose target is re-read on every use: it changes with the URL. */
  stamp?: string
}

async function targetFor(orca: OrcaWorkerApi, ref: string): Promise<Target> {
  const worktree = parseWorktreeRef(ref)
  if (worktree) {
    const { config, password, url } = await resolveWorktree(orca, worktree)
    return { config, password: async () => password, stamp: url }
  }
  const saved = await findSaved(orca, ref)
  if (saved) return { config: saved, password: () => passwordOf(orca, ref) }
  throw new Error(`No connection ${ref}`)
}

export function createConnections(orca: OrcaWorkerApi): Connections {
  const sessions = new Map<string, Promise<Session>>()
  const engine = createQueryEngine()

  /** The stamp each worktree session was opened with. */
  const stamps = new Map<string, string>()

  async function openSession(target: Target): Promise<Session> {
    return connect(target.config, await target.password())
  }

  function forget(ref: string): void {
    const open = sessions.get(ref)
    sessions.delete(ref)
    stamps.delete(ref)
    void open?.then((s) => s.close()).catch(() => undefined)
  }

  async function sessionFor(ref: string): Promise<Session> {
    const target = await targetFor(orca, ref)
    // The .env changed since this session opened: it points somewhere else now.
    if (target.stamp !== undefined && stamps.get(ref) !== target.stamp) forget(ref)
    let opened = sessions.get(ref)
    if (!opened) {
      opened = openSession(target)
      sessions.set(ref, opened)
      if (target.stamp !== undefined) stamps.set(ref, target.stamp)
      // A failed connect is not cached: the next request tries again.
      opened.catch(() => {
        if (sessions.get(ref) === opened) {
          sessions.delete(ref)
          stamps.delete(ref)
        }
      })
    }
    return opened
  }

  return {
    async list() {
      return {
        saved: await listSaved(orca),
        // Saved connections stay usable when Orca cannot list its workspaces.
        worktrees: await listWorktreeConnections(orca).catch(() => []),
      }
    },
    async save(input) {
      // Connecting proves a SQLite file is there and is a SQLite database; a server may be down.
      const entry = await saveConnection(orca, input, async (config) => {
        if (config.engine === 'sqlite') await (await connect(config)).close()
      })
      // An edit may have changed where it points or its password.
      forget(entry.ref)
      return entry
    },
    async test({ ref, form, password }) {
      const secret = password || (ref ? await passwordOf(orca, ref) : undefined)
      await (await connect(configOf(form), secret)).close()
    },
    get(ref) {
      return getSaved(orca, ref)
    },
    async delete(ref) {
      await deleteSaved(orca, ref)
      forget(ref)
    },
    async listObjects(ref) {
      return (await sessionFor(ref)).listObjects()
    },
    async dialect(ref) {
      return (await sessionFor(ref)).dialect
    },
    async quoteIdent(ref, name) {
      return (await sessionFor(ref)).quoteIdent(name)
    },
    async runQuery(ref, sql, options) {
      return engine.run(await sessionFor(ref), sql, options)
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
      stamps.clear()
      await Promise.allSettled(open.map(async (s) => (await s).close()))
    },
  }
}
