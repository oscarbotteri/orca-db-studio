// Runs a statement through the driver interface: cursor up to the row limit, cancel, timeout. Q3, G1
import { randomUUID } from 'node:crypto'
import type { Session } from '../drivers/types'
import type { QueryResult } from '../protocol'

/** A worker answer is at most 1 MiB; stop short of it. */
const ANSWER_BYTES = 900 * 1024

/** Values JSON cannot carry: integers beyond 2^53 become strings, binary a placeholder. */
function wireValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} B>`
  return value
}

/** Reads one row past the limit, which is how a cut-off is known without counting the table. */
export async function runStatement(
  session: Session,
  sql: string,
  rowLimit: number,
): Promise<QueryResult> {
  const cursor = await session.query(sql, { queryId: randomUUID() })
  try {
    const fetched = await cursor.fetch(rowLimit + 1)
    const rows: unknown[][] = []
    let bytes = 0
    for (const row of fetched.slice(0, rowLimit)) {
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
