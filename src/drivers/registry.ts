// Lazy driver registry: each engine is loaded on first use.
import type { Driver, Engine } from './types'

const loaders: Record<Engine, () => Promise<Driver>> = {
  postgres: async () => (await import('./postgres')).postgresDriver,
  mysql: async () => (await import('./mysql')).mysqlDriver,
  sqlite: async () => (await import('./sqlite')).sqliteDriver,
}

export function loadDriver(engine: Engine): Promise<Driver> {
  return loaders[engine]()
}
