// The worker's column tree as the schema option of the SQL language. Q2
import type { ColumnTree } from '../protocol'

export interface CompletionSchema {
  /** Schema name, then table name, then the table's columns. */
  schema: Record<string, Record<string, string[]>>
  /** Its tables complete without a prefix; unset when the connection has no default schema. */
  defaultSchema: string | undefined
}

/** A key set by definition: plain assignment cannot create `__proto__` and fails on read-only inherited ones. */
function setKey<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

export function completionSchema(tree: ColumnTree): CompletionSchema {
  // Schema and table names come from the database: no prototype for them to collide with.
  const schema: CompletionSchema['schema'] = Object.create(null)
  for (const table of tree.tables) {
    let tables = schema[table.schema]
    if (!tables) {
      tables = Object.create(null) as Record<string, string[]>
      setKey(schema, table.schema, tables)
    }
    setKey(tables, table.name, table.columns)
  }
  return { schema, defaultSchema: tree.defaultSchema || undefined }
}
