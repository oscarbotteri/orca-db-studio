// Keeps the editor's schema within one worker answer (1 MiB), whatever the engine returned.
import type { ColumnTree, TableColumns } from '../protocol'

/** Under the 1 MiB answer limit, leaving room for the request envelope. */
const SCHEMA_BUDGET_BYTES = 900 * 1024

function size(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

/**
 * Every table stays; a table whose columns no longer fit keeps its name and loses its columns.
 * Table names alone are not trimmed: a database with that many tables fails the request, and the
 * editor stays on keywords.
 */
export function fitToBudget(tree: ColumnTree): ColumnTree {
  const bare = tree.tables.map((table): TableColumns => ({ ...table, columns: [] }))
  let left = SCHEMA_BUDGET_BYTES - size({ defaultSchema: tree.defaultSchema, tables: bare })
  const tables = tree.tables.map((table, index) => {
    const extra = size(table.columns) - size([])
    if (extra > left) return bare[index] ?? table
    left -= extra
    return table
  })
  return { defaultSchema: tree.defaultSchema, tables }
}
