// Typed UI <-> worker contract, imported by both sides.
import type { SchemaTree } from './drivers/types'

export type { DbObject, SchemaNode, SchemaTree } from './drivers/types'

/** A connection as the panel lists it; `ref` is what a query document names. */
export interface ConnectionEntry {
  ref: string
  name: string
  /** Where it points, short enough to sit beside the name. */
  detail: string
}

export interface ConnectionList {
  sqliteFiles: ConnectionEntry[]
}

/** A SQLite file found in a workspace, offered by the chooser. */
export interface FoundSqliteFile {
  path: string
  /** The path inside its workspace. */
  relativePath: string
  workspaceName: string
}

/** Storage key the "Open SQLite File" command sets so the panel shows the chooser. */
export const CHOOSER_REQUEST_KEY = 'sqlite-chooser-requested'

declare module 'orca' {
  interface PluginRequests {
    'connections.list': { output: ConnectionList }
    'sqlite.findFiles': { output: { files: FoundSqliteFile[] } }
    'sqlite.add': { input: { path: string }; output: ConnectionEntry }
    'explorer.listObjects': { input: { ref: string }; output: SchemaTree }
  }
  interface PluginPanelEvents {
    'connections.changed': Record<string, never>
    /** The "Open SQLite File" command ran; an open panel shows the chooser at once. */
    'sqlite.chooserRequested': Record<string, never>
  }
}
