// PostgreSQL driver: pg for the connection, pg-cursor so rows are read in batches and never
// buffered whole. Cancel runs pg_cancel_backend from a second connection; a timeout is the
// server's statement_timeout, so the server ends the query itself.
import type { ClientConfig, FieldDef } from 'pg'
import { formatSize } from './format-size'
import type {
  ColumnMeta,
  ConnectionConfig,
  Driver,
  PostgresConfig,
  QueryCursor,
  QueryOptions,
  Row,
  SchemaTree,
  Session,
} from './types'

type PgModule = typeof import('../../vendor/pg.js')
type PgClient = InstanceType<PgModule['pg']['Client']>

const OID_DATE = 1082
const OID_TIMESTAMP = 1114
const OID_TIMESTAMPTZ = 1184
const OID_BYTEA = 17
const OID_JSON = 114
const OID_JSONB = 3802

/** Values as the other engines give them: dates as ISO strings, binary as a placeholder, JSON as text. */
function parseValue(oid: number, text: string): unknown {
  switch (oid) {
    case OID_DATE:
    case OID_JSON:
    case OID_JSONB:
      return text
    case OID_TIMESTAMP:
      return text.replace(' ', 'T')
    case OID_TIMESTAMPTZ: {
      const time = new Date(text)
      return Number.isNaN(time.getTime()) ? text : time.toISOString()
    }
    case OID_BYTEA:
      // Text format is "\x" followed by two hex digits per byte.
      return `<blob ${formatSize(Math.max(0, (text.length - 2) / 2))}>`
    default:
      return undefined
  }
}

function typeParsers(pg: PgModule['pg']) {
  return {
    getTypeParser(oid: number, format?: 'text' | 'binary') {
      const fallback = pg.types.getTypeParser(oid, format as 'text')
      return (text: string) => parseValue(oid, text) ?? fallback(text)
    },
  }
}

/** The hooks pg calls on a submitted query; pg-cursor's typings leave them out. */
interface CursorHooks {
  submit(connection: unknown): void
  handleRowDescription(message: { fields: FieldDef[] }): void
  handleError(error: Error): void
}

/** A cursor plus a promise of the result's fields, settled once the server has described it. */
function describedCursor(
  Cursor: PgModule['Cursor'],
  sql: string,
  types: ReturnType<typeof typeParsers>,
) {
  const cursor = new Cursor(sql, undefined, { rowMode: 'array', types })
  const hooks = cursor as unknown as CursorHooks
  const described = new Promise<FieldDef[]>((resolve, reject) => {
    const { submit, handleRowDescription, handleError } = hooks
    // The server answers the describe with row fields or with NoData, never both; whichever
    // does not come must not stay registered on the connection the session keeps for its life.
    let stopWaiting = () => {}
    hooks.submit = (connection) => {
      submit.call(cursor, connection)
      const emitter = connection as NodeJS.EventEmitter
      function onNoData() {
        resolve([])
      }
      emitter.once('noData', onNoData)
      stopWaiting = () => emitter.off('noData', onNoData)
    }
    hooks.handleRowDescription = (message) => {
      stopWaiting()
      handleRowDescription.call(cursor, message)
      resolve(message.fields)
    }
    hooks.handleError = (error) => {
      stopWaiting()
      reject(error)
      handleError.call(cursor, error)
    }
  })
  return { cursor, described }
}

class PostgresSession implements Session {
  readonly dialect = 'postgres'

  #client: PgClient
  #pid: number | undefined
  #timeoutMs = 0
  /** Type names by OID, read once at connect: a connection runs one statement at a time, so a cursor in flight blocks any later lookup. */
  #typeNames = new Map<number, string>()
  /** The query whose rows are being fetched, which cancel may stop. */
  #running: string | undefined

  constructor(
    private readonly pg: PgModule,
    private readonly config: ClientConfig,
  ) {
    this.#client = new pg.pg.Client(config)
    // An idle connection dropped by the server must not crash the worker; the next call reports it.
    this.#client.on('error', () => undefined)
  }

  async open(): Promise<void> {
    await this.#client.connect()
    const { rows } = await this.#client.query('SELECT pg_backend_pid() AS pid')
    this.#pid = rows[0].pid
    const types = await this.#client.query<{ oid: number; typname: string }>(
      'SELECT oid::int AS oid, typname FROM pg_type',
    )
    this.#typeNames = new Map(types.rows.map((row) => [row.oid, row.typname]))
  }

  async listObjects(): Promise<SchemaTree> {
    const { rows } = await this.#client.query<{
      schema: string
      name: string | null
      kind: string | null
    }>(
      `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
         FROM pg_namespace n
         LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'v', 'm')
        WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
        ORDER BY n.nspname, c.relname`,
    )
    const schemas = new Map<string, SchemaTree['schemas'][number]>()
    for (const row of rows) {
      let node = schemas.get(row.schema)
      if (!node) {
        node = { name: row.schema, objects: [] }
        schemas.set(row.schema, node)
      }
      if (row.name)
        node.objects.push({
          name: row.name,
          kind: row.kind === 'v' || row.kind === 'm' ? 'view' : 'table',
        })
    }
    return { schemas: [...schemas.values()] }
  }

  async #setTimeout(requested: number): Promise<void> {
    // Whole milliseconds; anything unusable means no timeout.
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : 0
    if (timeoutMs === this.#timeoutMs) return
    await this.#client.query(`SET statement_timeout = ${timeoutMs}`)
    this.#timeoutMs = timeoutMs
  }

  async query(sql: string, opts: QueryOptions): Promise<QueryCursor> {
    await this.#setTimeout(opts.timeoutMs ?? 0)
    const { cursor, described } = describedCursor(this.pg.Cursor, sql, typeParsers(this.pg.pg))
    this.#client.query(cursor)
    const fields = await described
    const columns: ColumnMeta[] = fields.map((field) => ({
      name: field.name,
      type: this.#typeNames.get(field.dataTypeID) ?? String(field.dataTypeID),
    }))
    const session = this
    let finished = false
    let failed = false

    async function read(count: number): Promise<{ rows: Row[]; rowCount: number | null }> {
      session.#running = opts.queryId
      try {
        const { rows, rowCount } = await new Promise<{ rows: Row[]; rowCount: number | null }>(
          (resolve, reject) => {
            cursor.read(count, (error, batch, result) => {
              if (error) reject(error)
              else resolve({ rows: batch as Row[], rowCount: result.rowCount })
            })
          },
        )
        if (rows.length < count) finished = true
        return { rows, rowCount }
      } catch (error) {
        failed = true
        throw error
      } finally {
        if (session.#running === opts.queryId) session.#running = undefined
      }
    }

    // A statement without rows has nothing to fetch later: run it now to learn its row count.
    const affectedRows = fields.length === 0 ? ((await read(1)).rowCount ?? 0) : undefined

    return {
      columns,
      affectedRows,
      async fetch(count: number): Promise<Row[]> {
        if (finished || failed) return []
        return (await read(count)).rows
      },
      async close() {
        // A portal that ran to its end or failed is already closed; closing it again would wait forever.
        if (finished || failed) return
        finished = true
        await cursor.close()
      },
    }
  }

  async cancel(queryId: string): Promise<void> {
    if (this.#running !== queryId || this.#pid === undefined) return
    const canceller = new this.pg.pg.Client(this.config)
    canceller.on('error', () => undefined)
    try {
      await canceller.connect()
      await canceller.query('SELECT pg_cancel_backend($1)', [this.#pid])
    } finally {
      await canceller.end().catch(() => undefined)
    }
  }

  quoteIdent(name: string): string {
    return `"${name.replaceAll('"', '""')}"`
  }

  async close(): Promise<void> {
    await this.#client.end().catch(() => undefined)
  }
}

function clientConfig(config: PostgresConfig, secret: string | undefined): ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: secret,
  }
}

export const postgresDriver: Driver = {
  async connect(config: ConnectionConfig, secret: string | undefined): Promise<Session> {
    if (config.engine !== 'postgres')
      throw new Error(`Not a PostgreSQL connection: ${config.engine}`)
    const session = new PostgresSession(
      await import('../../vendor/pg.js'),
      clientConfig(config, secret),
    )
    try {
      await session.open()
    } catch (error) {
      await session.close()
      throw error
    }
    return session
  },
}
