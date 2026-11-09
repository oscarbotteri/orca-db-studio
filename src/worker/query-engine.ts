// Runs a statement through the driver interface: cursor up to the row limit, cancel, timeout, and
// the full values of the rows it returned. Q3, G1, G3
import { randomUUID } from 'node:crypto'
import { formatSize } from '../drivers/common/utils'
import type { QueryOptions, Session } from '../drivers/common/types'
import type { CellValue, QueryResult } from '../protocol'
import { hasOwnLimit } from './own-limit'

/** A worker answer is at most 1 MiB, so no setting can ask for more rows than this. */
export const RESULT_CEILING_ROWS = 5000

/** A worker answer is at most 1 MiB; stop short of it. */
const ANSWER_BYTES = 900 * 1024

/** Text beyond this is cut; reading the full value is the full-value panel's job (G3). */
const CELL_CHARS = 300

function shorten(text: string): string {
  if (text.length <= CELL_CHARS) return text
  const cut = text.slice(0, CELL_CHARS)
  // Do not leave half of a surrogate pair at the end.
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

/** Values JSON cannot carry exactly: integers beyond 2^53 become strings, binary a placeholder. */
function wireValue(value: unknown): unknown {
  if (typeof value === 'string') return shorten(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `<blob ${formatSize(value.byteLength)}>`
  return value
}

/** A worker answer is at most 1 MiB, JSON quoting included, so a full value is cut to fit it. */
const CELL_ANSWER_BYTES = 1024 * 1024

/** Documents whose rows are kept at once; the frame cannot tell the worker reliably when it closes. */
const KEPT_DOCUMENTS = 16

export interface RunOptions {
  documentId: string
  rowLimit: number
  /** Ends the statement after this long; unset means no limit. */
  timeoutMs?: number
}

export interface QueryEngine {
  run(session: Session, sql: string, options: RunOptions): Promise<QueryResult>
  /** Stops the document's running query; does nothing when none runs. */
  cancel(documentId: string): Promise<void>
  cell(documentId: string, row: number, column: number): CellValue
  release(documentId: string): void
}

/** Text of a value as the full-value panel shows it. */
function fullText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return `<blob ${formatSize(value.byteLength)}>`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function answerBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify({ text, cut: false }))
}

/** The longest start of `text` whose JSON-quoted answer fits one worker answer. */
function cutToAnswer(text: string): CellValue {
  if (answerBytes(text) <= CELL_ANSWER_BYTES) return { text, cut: false }
  let cut = text.slice(0, CELL_ANSWER_BYTES)
  while (answerBytes(cut) > CELL_ANSWER_BYTES) {
    cut = cut.slice(0, Math.floor((cut.length * CELL_ANSWER_BYTES) / answerBytes(cut)) - 1)
  }
  // Do not leave half of a surrogate pair at the end.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
  return { text: cut, cut: true }
}

/** Full values by document, least recently run first, for the documents run most recently. */
function createKeptValues(): {
  replace(documentId: string, rows: unknown[][]): void
  get(documentId: string): unknown[][] | undefined
  drop(documentId: string): void
} {
  const rowsByDocument = new Map<string, unknown[][]>()
  return {
    replace(documentId, rows) {
      rowsByDocument.set(documentId, rows)
      for (const oldest of rowsByDocument.keys()) {
        if (rowsByDocument.size <= KEPT_DOCUMENTS) break
        rowsByDocument.delete(oldest)
      }
    },
    get: (documentId) => rowsByDocument.get(documentId),
    drop: (documentId) => void rowsByDocument.delete(documentId),
  }
}

function readCell(rows: unknown[][] | undefined, row: number, column: number): CellValue {
  if (!rows) throw new Error('The result is no longer available: run the query again.')
  const cells = rows[row]
  if (!cells || column < 0 || column >= cells.length) {
    throw new Error(`No such cell: row ${row}, column ${column}`)
  }
  const text = fullText(cells[column])
  return text === null ? { text: null, cut: false } : cutToAnswer(text)
}

export function createQueryEngine(): QueryEngine {
  const values = createKeptValues()
  const running = new Map<string, { session: Session; queryId: string }>()

  return {
    async run(session, sql, { documentId, rowLimit, timeoutMs }) {
      values.drop(documentId)
      const queryId = randomUUID()
      running.set(documentId, { session, queryId })
      try {
        const { result, full } = await runStatement(session, sql, rowLimit, { queryId, timeoutMs })
        values.replace(documentId, full)
        return result
      } finally {
        if (running.get(documentId)?.queryId === queryId) running.delete(documentId)
      }
    },
    async cancel(documentId) {
      const query = running.get(documentId)
      if (query) await query.session.cancel(query.queryId)
    },
    cell: (documentId, row, column) => readCell(values.get(documentId), row, column),
    release: values.drop,
  }
}

/** Reads one row past the limit, which is how a cut-off is known without counting the table. */
async function runStatement(
  session: Session,
  sql: string,
  rowLimit: number,
  opts: QueryOptions,
): Promise<{ result: QueryResult; full: unknown[][] }> {
  const cursor = await session.query(sql, opts)
  // A statement with its own LIMIT asks for exactly what it wants, up to the ceiling.
  const limit = hasOwnLimit(sql) ? RESULT_CEILING_ROWS : rowLimit
  try {
    const fetched = await cursor.fetch(limit + 1)
    const rows: unknown[][] = []
    let bytes = 0
    for (const row of fetched.slice(0, limit)) {
      const wired = row.map(wireValue)
      bytes += Buffer.byteLength(JSON.stringify(wired)) + 1
      if (bytes > ANSWER_BYTES) break
      rows.push(wired)
    }
    const truncated = rows.length < fetched.length
    const columns = cursor.columns.map((c) => c.name)
    return {
      result: {
        columns,
        rows,
        truncated,
        ...(cursor.affectedRows === undefined ? {} : { affectedRows: cursor.affectedRows }),
      },
      full: fetched.slice(0, rows.length),
    }
  } finally {
    await cursor.close()
  }
}
