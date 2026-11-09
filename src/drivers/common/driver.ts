// Driver, Session and Cursor interfaces. Code outside src/drivers never branches on engine.
import type { ConnectionConfig, SqlDialect } from './config'
import type { SchemaTree } from './schema'

export interface Driver {
  connect(config: ConnectionConfig, secret: string | undefined): Promise<Session>
}

export interface QueryOptions {
  queryId: string
  /** The server ends the statement after this long; unset means no limit. */
  timeoutMs?: number
}

export interface ColumnMeta {
  name: string
  type: string
}

export type Row = unknown[]

export interface Session {
  readonly dialect: SqlDialect
  listObjects(): Promise<SchemaTree>
  query(sql: string, opts: QueryOptions): Promise<QueryCursor>
  cancel(queryId: string): Promise<void>
  quoteIdent(name: string): string
  close(): Promise<void>
}

export interface QueryCursor {
  /** Empty for statements without rows. */
  columns: ColumnMeta[]
  affectedRows: number | undefined
  /** An empty array means the cursor is done. */
  fetch(count: number): Promise<Row[]>
  close(): Promise<void>
}
