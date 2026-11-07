// Driver, Session and Cursor interfaces. Code outside src/drivers never branches on engine.

export type Engine = 'sqlite'

export interface SqliteConfig {
  engine: 'sqlite'
  path: string
}

/** The SQL flavour an editor highlights for. */
export type SqlDialect = 'sqlite'

export type ConnectionConfig = SqliteConfig

export interface Driver {
  connect(config: ConnectionConfig, secret: string | undefined): Promise<Session>
}

export interface DbObject {
  name: string
  kind: 'table' | 'view'
}

export interface SchemaNode {
  name: string
  objects: DbObject[]
}

export interface SchemaTree {
  schemas: SchemaNode[]
}

export interface QueryOptions {
  queryId: string
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
