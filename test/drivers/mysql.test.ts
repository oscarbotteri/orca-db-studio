import { MariaDbContainer, type StartedMariaDbContainer } from '@testcontainers/mariadb'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { type Connection, createConnection, type RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Session } from '../../src/drivers'
import { loadDriver } from '../../src/drivers'
import { driverContract } from './contract'

interface Flavour {
  image: string
  dialect: 'mysql' | 'mariadb'
  start(): Promise<StartedMySqlContainer | StartedMariaDbContainer>
}

const FLAVOURS: Flavour[] = [
  {
    image: 'mysql:8',
    dialect: 'mysql',
    start: () => new MySqlContainer('mysql:8').start(),
  },
  {
    image: 'mariadb:10.6',
    dialect: 'mariadb',
    start: () => new MariaDbContainer('mariadb:10.6').start(),
  },
]

/** Seconds of work that a kill or a timeout interrupts with an error (SLEEP would just return early). */
const SLOW = `SELECT COUNT(*) FROM information_schema.columns a, information_schema.columns b, information_schema.columns c, information_schema.columns d`

async function fetchAll(session: Session, sql: string, queryId = crypto.randomUUID()) {
  const cursor = await session.query(sql, { queryId })
  try {
    return { columns: cursor.columns, rows: await cursor.fetch(1000) }
  } finally {
    await cursor.close()
  }
}

for (const flavour of FLAVOURS) {
  describe(flavour.image, () => {
    let container: StartedMySqlContainer | StartedMariaDbContainer
    let admin: Connection
    let database = ''

    beforeAll(async () => {
      container = await flavour.start()
      admin = await createConnection({
        host: container.getHost(),
        port: container.getPort(),
        user: 'root',
        password: container.getRootPassword(),
      })
    }, 180_000)

    afterAll(async () => {
      await admin?.end()
      await container?.stop()
    })

    /** A session on a database of its own, so every test starts empty. */
    async function open(): Promise<Session> {
      database = `db_${crypto.randomUUID().replaceAll('-', '')}`
      await admin.query(`CREATE DATABASE ${database}`)
      await admin.query(`GRANT ALL ON ${database}.* TO '${container.getUsername()}'@'%'`)
      const driver = await loadDriver('mysql')
      return driver.connect(
        {
          engine: 'mysql',
          host: container.getHost(),
          port: container.getPort(),
          database,
          user: container.getUsername(),
        },
        container.getUserPassword(),
      )
    }

    /** Statements running on the server whose text contains `text`, other than the lookup itself. */
    async function activeQueries(text: string): Promise<number> {
      const [rows] = await admin.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.processlist WHERE command = 'Query' AND id <> CONNECTION_ID() AND info LIKE ?",
        [`%${text}%`],
      )
      return Number(rows[0]?.n)
    }

    driverContract(flavour.image, { open, schema: () => database, slowQuery: SLOW })

    describe(`${flavour.image} driver`, () => {
      let session: Session

      beforeAll(async () => {
        session = await open()
      })

      afterAll(async () => {
        await session.close()
      })

      test('names its SQL dialect for the editor', () => {
        expect(session.dialect).toBe(flavour.dialect)
      })

      test('returns values the way the other engines do', async () => {
        const { columns, rows } = await fetchAll(
          session,
          `SELECT 9007199254740993 AS big, 12.50 AS num, DATE '2024-03-05' AS d,
                  CAST('2024-03-05 06:07:08' AS DATETIME) AS dt, X'DEADBEEF' AS bin,
                  JSON_OBJECT('a', 1, 'b', JSON_ARRAY(2)) AS j, 'héllo ✓' AS txt`,
        )
        expect(columns.map((c) => c.name)).toEqual(['big', 'num', 'd', 'dt', 'bin', 'j', 'txt'])
        expect(rows[0]?.slice(0, 5)).toEqual([
          '9007199254740993',
          '12.50',
          '2024-03-05',
          '2024-03-05T06:07:08',
          '<blob 4 B>',
        ])
        expect(JSON.parse(String(rows[0]?.[5]))).toEqual({ a: 1, b: [2] })
        expect(rows[0]?.[6]).toBe('héllo ✓')
      })

      test('a failing statement rejects with the database error', async () => {
        await expect(
          session.query('SELECT * FROM missing_table', { queryId: 'bad' }),
        ).rejects.toThrow(/missing_table/)
        expect((await fetchAll(session, 'SELECT 1')).rows).toHaveLength(1)
      })

      test('runs one statement per call', async () => {
        await expect(session.query('SELECT 1; SELECT 2', { queryId: 'two' })).rejects.toThrow()
      })

      test('a large result is streamed, not buffered', async () => {
        const before = process.memoryUsage().rss
        await fetchAll(session, 'CREATE TABLE digits (n INT)')
        await fetchAll(session, 'INSERT INTO digits VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)')
        // A billion rows if read to the end.
        const cursor = await session.query(
          "SELECT REPEAT('x', 200) AS pad FROM digits a, digits b, digits c, digits d, digits e, digits f, digits g, digits h, digits i",
          { queryId: 'large' },
        )
        for (let i = 0; i < 3; i++) expect(await cursor.fetch(1000)).toHaveLength(1000)
        await cursor.close()
        expect(process.memoryUsage().rss - before).toBeLessThan(100 * 1024 * 1024)
        await expect.poll(() => activeQueries('digits a, digits b')).toBe(0)
        expect((await fetchAll(session, 'SELECT 1')).rows).toHaveLength(1)
      }, 60_000)

      test('cancel stops the query on the server', async () => {
        const failure = session
          .query(`${SLOW} /* cancel_marker */`, { queryId: 'cancel-me' })
          .then((cursor) => cursor.fetch(1))
          .then(
            () => undefined,
            (error: Error) => error,
          )
        await expect.poll(() => activeQueries('cancel_marker')).toBe(1)
        await session.cancel('cancel-me')
        expect((await failure)?.message).toMatch(/cancel/i)
        await expect.poll(() => activeQueries('cancel_marker')).toBe(0)
      })

      test('a timeout ends the query on the server', async () => {
        await expect(
          session
            .query(`${SLOW} /* timeout_marker */`, { queryId: 'timeout', timeoutMs: 500 })
            .then((cursor) => cursor.fetch(1)),
        ).rejects.toThrow(/interrupted|max_statement_time|maximum statement execution time/i)
        await expect.poll(() => activeQueries('timeout_marker')).toBe(0)
        // The timeout belongs to that query only.
        const slow = await fetchAll(session, 'SELECT SLEEP(1), 3')
        expect(slow.rows).toHaveLength(1)
      }, 30_000)
    })
  })
}
