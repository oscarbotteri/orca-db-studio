import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { loadDriver } from '../../src/drivers/registry'
import type { Session } from '../../src/drivers/common/types'
import { driverContract } from './contract'

const VERSIONS = ['postgres:13-alpine', 'postgres:latest']

async function fetchAll(session: Session, sql: string, queryId = crypto.randomUUID()) {
  const cursor = await session.query(sql, { queryId })
  try {
    return { columns: cursor.columns, rows: await cursor.fetch(1000) }
  } finally {
    await cursor.close()
  }
}

for (const image of VERSIONS) {
  describe(image, () => {
    let container: StartedPostgreSqlContainer
    let admin: Client

    beforeAll(async () => {
      container = await new PostgreSqlContainer(image).start()
      admin = new Client({ connectionString: container.getConnectionUri() })
      await admin.connect()
    }, 120_000)

    afterAll(async () => {
      await admin?.end()
      await container?.stop()
    })

    /** A session on a database of its own, so every test starts empty. */
    async function open(): Promise<Session> {
      const database = `db_${crypto.randomUUID().replaceAll('-', '')}`
      await admin.query(`CREATE DATABASE ${database}`)
      const driver = await loadDriver('postgres')
      return driver.connect(
        {
          engine: 'postgres',
          host: container.getHost(),
          port: container.getPort(),
          database,
          user: container.getUsername(),
        },
        container.getPassword(),
      )
    }

    async function activeQueries(text: string): Promise<number> {
      const { rows } = await admin.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND query LIKE $1 AND pid <> pg_backend_pid()",
        [`%${text}%`],
      )
      return rows[0].n
    }

    driverContract(image, { open, schema: 'public', slowQuery: 'SELECT pg_sleep(30)' })

    describe(`${image} driver`, () => {
      let session: Session

      beforeAll(async () => {
        session = await open()
      })

      afterAll(async () => {
        await session.close()
      })

      test('names its SQL dialect for the editor', () => {
        expect(session.dialect).toBe('postgres')
      })

      test('returns values the way the other engines do', async () => {
        const { columns, rows } = await fetchAll(
          session,
          `SELECT 9007199254740993::bigint AS big, 12.50::numeric(10,2) AS num,
                  DATE '2024-03-05' AS d, TIMESTAMP '2024-03-05 06:07:08.5' AS ts,
                  TIMESTAMPTZ '2024-03-05 06:07:08+02' AS tstz, '\\xdeadbeef'::bytea AS bin,
                  '{"a": 1,  "b": [2]}'::jsonb AS j, '{"a": 1,  "b": [2]}'::json AS js`,
        )
        expect(columns.map((c) => c.type)).toEqual([
          'int8',
          'numeric',
          'date',
          'timestamp',
          'timestamptz',
          'bytea',
          'jsonb',
          'json',
        ])
        expect(rows).toEqual([
          [
            '9007199254740993',
            '12.50',
            '2024-03-05',
            '2024-03-05T06:07:08.5',
            '2024-03-05T04:07:08.000Z',
            '<blob 4 B>',
            '{"a": 1, "b": [2]}',
            '{"a": 1,  "b": [2]}',
          ],
        ])
      })

      test('many queries on one session leave no listeners behind', async () => {
        const warnings: string[] = []
        const onWarning = (warning: Error) => warnings.push(warning.name)
        process.on('warning', onWarning)
        try {
          for (let i = 0; i < 15; i++) await fetchAll(session, 'SELECT 1')
          await new Promise((resolve) => setImmediate(resolve))
        } finally {
          process.off('warning', onWarning)
        }
        expect(warnings).not.toContain('MaxListenersExceededWarning')
      })

      test('an unusable timeout is treated as no timeout', async () => {
        const cursor = await session.query('SELECT 1', { queryId: 'nan', timeoutMs: Number.NaN })
        expect(await cursor.fetch(10)).toEqual([[1]])
        await cursor.close()
      })

      test('a failing statement rejects with the database error', async () => {
        await expect(
          session.query('SELECT * FROM missing_table', { queryId: 'bad' }),
        ).rejects.toThrow(/missing_table/)
        expect((await fetchAll(session, 'SELECT 1')).rows).toEqual([[1]])
      })

      test('a large result is read only as far as it is fetched', async () => {
        const before = process.memoryUsage().rss
        const cursor = await session.query(
          "SELECT g, repeat('x', 200) FROM generate_series(1, 20000000) g",
          { queryId: 'large' },
        )
        for (let i = 0; i < 3; i++) expect(await cursor.fetch(1000)).toHaveLength(1000)
        await cursor.close()
        expect(process.memoryUsage().rss - before).toBeLessThan(100 * 1024 * 1024)
        expect(await activeQueries('generate_series(1, 20000000)')).toBe(0)
        expect((await fetchAll(session, 'SELECT 1')).rows).toEqual([[1]])
      }, 30_000)

      test('cancel stops the query on the server', async () => {
        const sql = 'SELECT pg_sleep(60), 1 AS cancel_marker'
        const cursor = await session.query(sql, { queryId: 'cancel-me' })
        const failure = cursor.fetch(1).then(
          () => undefined,
          (error: Error) => error,
        )
        await expect.poll(() => activeQueries('cancel_marker')).toBe(1)
        await session.cancel('cancel-me')
        expect((await failure)?.message).toMatch(/cancel/i)
        await expect.poll(() => activeQueries('cancel_marker')).toBe(0)
      })

      test('a timeout ends the query on the server', async () => {
        const cursor = await session.query('SELECT pg_sleep(60), 2 AS timeout_marker', {
          queryId: 'timeout',
          timeoutMs: 500,
        })
        await expect(cursor.fetch(1)).rejects.toThrow(/statement timeout/i)
        await expect.poll(() => activeQueries('timeout_marker')).toBe(0)
        // The timeout belongs to that query only.
        const slow = await fetchAll(session, 'SELECT pg_sleep(1), 3')
        expect(slow.rows).toHaveLength(1)
      }, 30_000)
    })
  })
}
