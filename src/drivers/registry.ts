// Lazy driver registry: each engine is loaded on first use.
import type { Driver, Engine } from './common/types'

const loaders: Record<Engine, () => Promise<Driver>> = {
  postgres: async () => (await import('./postgres/driver')).postgresDriver,
  mysql: async () => (await import('./mysql/driver')).mysqlDriver,
  sqlite: async () => (await import('./sqlite/driver')).sqliteDriver,
}

export function loadDriver(engine: Engine): Promise<Driver> {
  return loaders[engine]()
}
