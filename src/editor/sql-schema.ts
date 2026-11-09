// The worker's column tree as the schema option of the SQL language. Q2
import type { ColumnTree } from '../protocol'

export interface CompletionSchema {
  /** Schema name, then table name, then the table's columns. */
  schema: Record<string, Record<string, string[]>>
  /** Its tables complete without a prefix; unset when the connection has no default schema. */
  defaultSchema: string | undefined
}

export function completionSchema(tree: ColumnTree): CompletionSchema {
  const schema: CompletionSchema['schema'] = {}
  for (const table of tree.tables) {
    const tables = schema[table.schema] ?? {}
    tables[table.name] = table.columns
    schema[table.schema] = tables
  }
  return { schema, defaultSchema: tree.defaultSchema || undefined }
}
