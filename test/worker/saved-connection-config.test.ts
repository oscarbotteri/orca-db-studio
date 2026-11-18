// configOf maps a cleaned form to a driver config, including the SSL flag a pasted sslmode set. C6
import { describe, expect, test } from 'vitest'
import type { ServerForm } from '../../src/protocol'
import { configOf } from '../../src/worker/saved-connections'

const base: ServerForm = {
  name: 'db',
  engine: 'postgres',
  host: 'db.example.com',
  port: 5432,
  database: 'shop',
  user: 'app',
}

describe('configOf SSL threading', () => {
  test('carries ssl=true through for a Postgres connection', () => {
    expect(configOf({ ...base, ssl: true })).toMatchObject({ engine: 'postgres', ssl: true })
  })

  test('carries ssl=false through so an explicit disable is not re-enabled by the host default', () => {
    expect(configOf({ ...base, ssl: false })).toMatchObject({ engine: 'postgres', ssl: false })
  })

  test('leaves ssl absent when the form carries no sslmode', () => {
    expect(configOf(base)).not.toHaveProperty('ssl')
  })

  test('drops a stray ssl on a non-Postgres engine', () => {
    const mysql = { ...base, engine: 'mysql' as const, port: 3306, ssl: true }
    expect(configOf(mysql)).not.toHaveProperty('ssl')
  })
})
