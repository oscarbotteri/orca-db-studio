// Driver, Session and Cursor interfaces. Code outside src/drivers never branches on engine.

export type Engine = 'postgres' | 'mysql' | 'sqlite'

export interface SqliteConfig {
  engine: 'sqlite'
  path: string
}

export interface PostgresConfig {
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
}

export interface MysqlConfig {
  engine: 'mysql'
  host: string
  port: number
  database: string
  user: string
}

/** The SQL flavour an editor highlights for. */
export type SqlDialect = 'postgres' | 'mysql' | 'mariadb' | 'sqlite'

export type ConnectionConfig = PostgresConfig | MysqlConfig | SqliteConfig

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
