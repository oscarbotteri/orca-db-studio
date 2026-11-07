// Typed UI <-> worker contract, imported by both sides.
import type { SchemaTree, SqlDialect } from './drivers/types'

export type { DbObject, SchemaNode, SchemaTree, SqlDialect } from './drivers/types'

/** A connection as the panel lists it; `ref` is what a query document names. */
export interface ConnectionEntry {
  ref: string
  name: string
  /** Where it points, short enough to sit beside the name. */
  detail: string
}

export interface ConnectionList {
  sqliteFiles: ConnectionEntry[]
  /** Saved connections to a database server. */
  servers: ConnectionEntry[]
}

/** The engines the form offers; the worker refuses the ones without a driver yet. */
export type ServerEngine = 'postgres' | 'mysql'

/** What the connection form edits; the password travels beside it and is never stored here. */
export interface ConnectionForm {
  name: string
  engine: ServerEngine
  host: string
  port: number
  database: string
  user: string
}

export interface SavedConnection {
  form: ConnectionForm
  /** Whether a password is kept for it, so the form can say "unchanged". */
  hasPassword: boolean
}

/** A SQLite file found in a workspace, offered by the chooser. */
export interface FoundSqliteFile {
  path: string
  /** The path inside its workspace. */
  relativePath: string
  workspaceName: string
}

/** A workspace the panel offers when the focused one is ambiguous. */
export interface WorkspaceChoice {
  id: string
  name: string
}

export type OpenTableResult =
  | { status: 'opened'; path: string }
  | { status: 'choose-workspace'; workspaces: WorkspaceChoice[] }

/** One statement's rows, cut off at the row limit when `truncated`. */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  /** Set for statements without rows. */
  affectedRows?: number
}

/** Storage key the "Open SQLite File" command sets so the panel shows the chooser. */
export const CHOOSER_REQUEST_KEY = 'sqlite-chooser-requested'

declare module 'orca' {
  interface PluginRequests {
    'connections.list': { output: ConnectionList }
    'sqlite.findFiles': { output: { files: FoundSqliteFile[] } }
    'sqlite.add': { input: { path: string }; output: ConnectionEntry }
    /** `password` unset keeps the stored one when editing; without `ref` a new connection is made. */
    'connection.save': {
      input: { ref?: string; form: ConnectionForm; password?: string }
      output: ConnectionEntry
    }
    /** Connects with the form's values and closes again; rejects with why it could not. */
    'connection.test': {
      input: { ref?: string; form: ConnectionForm; password?: string }
      output: Record<string, never>
    }
    'connection.get': { input: { ref: string }; output: SavedConnection }
    'connection.delete': { input: { ref: string }; output: Record<string, never> }
    'explorer.listObjects': { input: { ref: string }; output: SchemaTree }
    /** Without `workspaceId` the worker picks the focused workspace or asks to choose one. */
    'table.open': {
      input: { ref: string; schema: string; table: string; workspaceId?: string }
      output: OpenTableResult
    }
    'connection.info': { input: { ref: string }; output: { dialect: SqlDialect } }
    'query.run': { input: { ref: string; sql: string }; output: QueryResult }
  }
  interface PluginPanelEvents {
    'connections.changed': Record<string, never>
    /** The "Open SQLite File" command ran; an open panel shows the chooser at once. */
    'sqlite.chooserRequested': Record<string, never>
  }
}
