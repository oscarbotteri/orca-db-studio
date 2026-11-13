// Which engine a connection reaches and how: the part of a connection the worker saves and reads.

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
  /** Connect over SSL. Undefined lets the driver decide from the host. */
  ssl?: boolean
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
