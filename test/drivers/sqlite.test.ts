import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadDriver } from '../../src/drivers'
import { driverContract } from './contract'

// Counts to 100 million: several seconds of work in SQLite before the one row comes back.
const SLOW_QUERY =
  'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100000000) SELECT count(*) FROM n'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'db-studio-sqlite-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function newDatabase(): string {
  const path = join(dir, `${crypto.randomUUID()}.db`)
  new DatabaseSync(path).close()
  return path
}

driverContract('SQLite', {
  schema: 'main',
  slowQuery: SLOW_QUERY,
  async open() {
    const driver = await loadDriver('sqlite')
    return driver.connect({ engine: 'sqlite', path: newDatabase() }, undefined)
  },
})

describe('SQLite driver', () => {
  test('a slow statement does not block other work', async () => {
    const driver = await loadDriver('sqlite')
    const path = newDatabase()
    const slow = await driver.connect({ engine: 'sqlite', path }, undefined)
    const other = await driver.connect({ engine: 'sqlite', path }, undefined)
    try {
      const cursor = await slow.query(SLOW_QUERY, { queryId: 'slow' })
      const slowRow = cursor.fetch(1).then(
        () => 'slow',
        () => 'slow',
      )
      const timer = new Promise((resolve) => setTimeout(() => resolve('timer'), 50))
      expect(await Promise.race([slowRow, timer])).toBe('timer')
      const listed = other.listObjects().then(() => 'other')
      expect(await Promise.race([slowRow, listed])).toBe('other')
      await slow.cancel('slow')
    } finally {
      await slow.close()
      await other.close()
    }
  })

  test('lists the columns of the healthy tables when a view is broken', async () => {
    const path = newDatabase()
    const db = new DatabaseSync(path)
    db.exec(
      'CREATE TABLE gone (id INTEGER); CREATE TABLE ok (a INTEGER, b TEXT); CREATE VIEW broken AS SELECT id FROM gone; DROP TABLE gone',
    )
    db.close()
    const driver = await loadDriver('sqlite')
    const session = await driver.connect({ engine: 'sqlite', path }, undefined)
    try {
      expect((await session.listColumns()).tables).toEqual([
        { schema: 'main', name: 'ok', columns: ['a', 'b'] },
      ])
    } finally {
      await session.close()
    }
  })

  test('refuses a file that is not a SQLite database', async () => {
    const path = join(dir, 'notes.db')
    await writeFile(path, 'just some text, not a database')
    const driver = await loadDriver('sqlite')
    await expect(driver.connect({ engine: 'sqlite', path }, undefined)).rejects.toThrow(
      `${path} is not a SQLite database`,
    )
  })

  test('refuses a path with no file instead of creating one', async () => {
    const path = join(dir, 'missing.db')
    const driver = await loadDriver('sqlite')
    await expect(driver.connect({ engine: 'sqlite', path }, undefined)).rejects.toThrow(
      `No file at ${path}`,
    )
  })
})
