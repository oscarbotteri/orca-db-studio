// Which engine a connection reaches and how: the part of a connection the worker saves and reads.

export type Engine = 'postgres' | 'mysql' | 'sqlite'

/**
 * How a server connection is encrypted, named as libpq's sslmode is. `disable` keeps plain TCP,
 * which is what a local server usually offers; `require` encrypts without checking the server's
 * certificate, which is what a hosted server such as Neon asks for; `verify-full` checks it too.
 */
export type SslMode = 'disable' | 'require' | 'verify-full'

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
  /** Where a saved connection was told to encrypt; unset means plain TCP. */
  ssl?: SslMode
}

export interface MysqlConfig {
  engine: 'mysql'
  host: string
  port: number
  database: string
  user: string
  /** Where a saved connection was told to encrypt; unset means plain TCP. */
  ssl?: SslMode
}

/** The SQL flavour an editor highlights for. */
export type SqlDialect = 'postgres' | 'mysql' | 'mariadb' | 'sqlite'

export type ConnectionConfig = PostgresConfig | MysqlConfig | SqliteConfig
