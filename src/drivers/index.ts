// The only import path into src/drivers. Lazy driver registry: each engine is loaded on first use.
import type { Engine } from './common/config'
import type { Driver } from './common/driver'

export type {
  ConnectionConfig,
  Engine,
  MysqlConfig,
  PostgresConfig,
  SqlDialect,
  SqliteConfig,
} from './common/config'
export type {
  ColumnMeta,
  Driver,
  QueryCursor,
  QueryOptions,
  Row,
  Session,
} from './common/driver'
export type {
  ColumnTree,
  DbObject,
  SchemaNode,
  SchemaTree,
  TableColumns,
} from './common/schema'
export { formatSize } from './common/utils'

const loaders: Record<Engine, () => Promise<Driver>> = {
  postgres: async () => (await import('./postgres/driver')).postgresDriver,
  mysql: async () => (await import('./mysql/driver')).mysqlDriver,
  sqlite: async () => (await import('./sqlite/driver')).sqliteDriver,
}

export function loadDriver(engine: Engine): Promise<Driver> {
  return loaders[engine]()
}
