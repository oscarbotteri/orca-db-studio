// Runs a statement through the driver interface: cursor up to the row limit, cancel, timeout. Q3, G1
import { randomUUID } from 'node:crypto'
import { formatSize } from '../drivers/format-size'
import type { Session } from '../drivers/types'
import type { QueryResult } from '../protocol'
import { hasOwnLimit } from './own-limit'

/** A worker answer is at most 1 MiB, so no setting can ask for more rows than this. */
export const RESULT_CEILING_ROWS = 5000

/** A worker answer is at most 1 MiB; stop short of it. */
const ANSWER_BYTES = 900 * 1024

/** Text beyond this is cut; the full value is fetched on demand. */
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
  if (value instanceof Date) return value.toISOString()
  return value
}

/** Reads one row past the limit, which is how a cut-off is known without counting the table. */
export async function runStatement(
  session: Session,
  sql: string,
  rowLimit: number,
): Promise<QueryResult> {
  const cursor = await session.query(sql, { queryId: randomUUID() })
  // A statement with its own LIMIT asks for exactly what it wants, up to the ceiling.
  const limit = hasOwnLimit(sql) ? RESULT_CEILING_ROWS : rowLimit
  try {
    const fetched = await cursor.fetch(limit + 1)
    const rows: unknown[][] = []
    let bytes = 0
    for (const row of fetched.slice(0, limit)) {
      const wired = row.map(wireValue)
      bytes += JSON.stringify(wired).length + 1
      if (bytes > ANSWER_BYTES) break
      rows.push(wired)
    }
    const truncated = rows.length < fetched.length
    const columns = cursor.columns.map((c) => c.name)
    return {
      columns,
      rows,
      truncated,
      ...(cursor.affectedRows === undefined ? {} : { affectedRows: cursor.affectedRows }),
    }
  } finally {
    await cursor.close()
  }
}
