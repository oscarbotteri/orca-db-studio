// Seam A: the driver contract, written once against the driver interface and run on every engine.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Row, Session } from '../../src/drivers/types'

export interface ContractTarget {
  /** A session on an empty database. */
  open(): Promise<Session>
  /** The schema that unqualified tables land in. */
  schema: string
  /** A statement that runs for several seconds before its first row. */
  slowQuery: string
}

async function run(session: Session, sql: string): Promise<Row[]> {
  const cursor = await session.query(sql, { queryId: crypto.randomUUID() })
  try {
    return await cursor.fetch(1000)
  } finally {
    await cursor.close()
  }
}

export function driverContract(name: string, target: ContractTarget): void {
  describe(`${name} driver contract`, () => {
    let session: Session

    beforeEach(async () => {
      session = await target.open()
      await run(session, 'CREATE TABLE items (id INTEGER PRIMARY KEY, name VARCHAR(50))')
      await run(session, 'CREATE VIEW item_names AS SELECT name FROM items')
    })

    afterEach(async () => {
      await session.close()
    })

    test('lists tables and views by schema', async () => {
      const tree = await session.listObjects()
      const schema = tree.schemas.find((s) => s.name === target.schema)
      expect(schema?.objects).toEqual([
        { name: 'item_names', kind: 'view' },
        { name: 'items', kind: 'table' },
      ])
    })

    test('reports affected rows for a statement without rows', async () => {
      const cursor = await session.query("INSERT INTO items (id, name) VALUES (1, 'a'), (2, 'b')", {
        queryId: 'insert',
      })
      expect(cursor.columns).toEqual([])
      expect(cursor.affectedRows).toBe(2)
      expect(await cursor.fetch(10)).toEqual([])
      await cursor.close()
    })

    test('fetches rows in batches until the cursor is done', async () => {
      await run(session, "INSERT INTO items (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')")
      const cursor = await session.query('SELECT id, name, id FROM items ORDER BY id', {
        queryId: 'select',
      })
      expect(cursor.columns.map((c) => c.name)).toEqual(['id', 'name', 'id'])
      expect(cursor.affectedRows).toBeUndefined()
      expect(await cursor.fetch(2)).toEqual([
        [1, 'a', 1],
        [2, 'b', 2],
      ])
      expect(await cursor.fetch(2)).toEqual([[3, 'c', 3]])
      expect(await cursor.fetch(2)).toEqual([])
      await cursor.close()
    })

    test('quotes identifiers so they can be used in SQL', async () => {
      const table = session.quoteIdent('odd "name"')
      await run(session, `CREATE TABLE ${table} (id INTEGER)`)
      await run(session, `INSERT INTO ${table} (id) VALUES (7)`)
      expect(await run(session, `SELECT id FROM ${table}`)).toEqual([[7]])
    })

    test('cancel stops a running query and the session keeps working', async () => {
      const cursor = await session.query(target.slowQuery, { queryId: 'slow' })
      const fetching = cursor.fetch(1)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await session.cancel('slow')
      await expect(fetching).rejects.toThrow(/cancel/i)
      expect(await run(session, 'SELECT 1')).toEqual([[1]])
    })
  })
}
