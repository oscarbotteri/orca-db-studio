// Lazy driver registry: each engine is loaded on first use.
import type { Driver, Engine } from './types'

const loaders: Record<Engine, () => Promise<Driver>> = {
  postgres: async () => (await import('./postgres')).postgresDriver,
  sqlite: async () => (await import('./sqlite')).sqliteDriver,
}

export function loadDriver(engine: Engine): Promise<Driver> {
  return loaders[engine]()
}
