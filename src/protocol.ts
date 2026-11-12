// Typed UI <-> worker contract, imported by both sides.
import type { ColumnTree, SchemaTree, SqlDialect } from './drivers'

export type {
  ColumnTree,
  DbObject,
  SchemaNode,
  SchemaTree,
  SqlDialect,
  TableColumns,
} from './drivers'

/** Saved by the person in DB Studio, or read from a worktree's .env on every use. */
export type ConnectionOrigin = 'saved' | 'worktree'

/** What a saved connection points at, for the label every query document on it shows. */
export type Environment = 'local' | 'dev' | 'staging' | 'prod'

/** Orca's theme tones: the color a label is drawn in. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/** A saved connection's environment and the tone it is drawn in, both stored explicitly. */
export interface EnvironmentLabel {
  environment: Environment
  tone: Tone
}

/** A connection as the panel lists it; `ref` is what a query document names. */
export interface ConnectionEntry {
  ref: string
  name: string
  /** Where it points, short enough to sit beside the name. */
  detail: string
  origin: ConnectionOrigin
  /** Saved connections only; a worktree connection has none. */
  label?: EnvironmentLabel
}

export interface ConnectionList {
  /** Server connections and SQLite files, by name. */
  saved: ConnectionEntry[]
  /** One per local workspace whose .env defines the connection variable; named for the workspace. */
  worktrees: ConnectionEntry[]
}

/** The server engines the connection form offers. */
export type ServerEngine = 'postgres' | 'mysql'

/** What the connection form edits for a server; the password travels beside it, never in it. */
export interface ServerForm {
  name: string
  engine: ServerEngine
  host: string
  port: number
  database: string
  user: string
  label?: EnvironmentLabel
}

/** What the connection form edits for a SQLite file: an absolute path. */
export interface SqliteForm {
  name: string
  engine: 'sqlite'
  path: string
  label?: EnvironmentLabel
}

export type ConnectionForm = ServerForm | SqliteForm

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

/** A workspace the panel offers when DB Studio cannot tell which one a query document goes in. */
export interface WorkspaceChoice {
  id: string
  name: string
}

/** What opening a query document answers, for a table or a new query. */
export type OpenDocumentResult =
  | { status: 'opened'; path: string; workspaceName: string }
  | { status: 'choose-workspace'; workspaces: WorkspaceChoice[] }

/** One statement's rows, cut off at the row limit when `truncated`. */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  /** Set for statements without rows. */
  affectedRows?: number
}

/** One cell's full value as text, cut at 1 MiB (`cut`) so the answer fits the host's limit. */
export interface CellValue {
  /** `null` is SQL NULL. */
  text: string | null
  cut: boolean
}

/**
 * Storage key of the saved-connection registry. Named before SQLite files joined it; renaming it
 * would lose every saved connection. Frames watch it to learn that a label changed.
 */
export const SAVED_CONNECTIONS_KEY = 'server-connections'

/** Storage key the "Open SQLite File" command sets so the panel opens the form on SQLite. */
export const SQLITE_FORM_REQUEST_KEY = 'sqlite-form-requested'

/** Storage key the "New Query" command sets to the workspaces the panel asks the person to choose from. */
export const NEW_QUERY_REQUEST_KEY = 'new-query-requested'

declare module 'orca' {
  interface PluginRequests {
    'connections.list': { output: ConnectionList }
    'sqlite.findFiles': { output: { files: FoundSqliteFile[] } }
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
    /** A SQLite file is only forgotten; it is never touched on disk. */
    'connection.delete': { input: { ref: string }; output: Record<string, never> }
    'explorer.listObjects': { input: { ref: string }; output: SchemaTree }
    /** Every table and view with its columns, for the editor's completion. */
    'editor.schema': { input: { ref: string }; output: ColumnTree }
    /**
     * Without `workspaceId` the worker picks the focused workspace, else the only local one, else
     * asks to choose.
     */
    'table.open': {
      input: { ref: string; schema: string; table: string; workspaceId?: string }
      output: OpenDocumentResult
    }
    /** An empty query document in the chosen workspace, for the "New Query" command. X1 */
    'query.new': { input: { workspaceId: string }; output: OpenDocumentResult }
    'connection.info': { input: { ref: string }; output: { dialect: SqlDialect } }
    /** `documentId` names the query document; its rows replace the ones the last run kept. */
    'query.run': { input: { ref: string; sql: string; documentId: string }; output: QueryResult }
    /** Stops the document's running query, which then rejects as cancelled. */
    'query.cancel': { input: { documentId: string }; output: Record<string, never> }
    /** The full value of a cell of the document's last result, by position. */
    'query.cell': {
      input: { documentId: string; row: number; column: number }
      output: CellValue
    }
    /** The document closed: forget the rows its last run kept. */
    'query.release': { input: { documentId: string }; output: Record<string, never> }
  }
  interface PluginPanelEvents {
    'connections.changed': Record<string, never>
    /** The "Open SQLite File" command ran; an open panel opens the form on SQLite at once. */
    'sqlite.formRequested': Record<string, never>
  }
}
