// The tables and views a connection lists, as the explorer shows them, and their columns.

export interface DbObject {
  name: string
  kind: 'table' | 'view'
}

export interface SchemaNode {
  name: string
  objects: DbObject[]
}

export interface SchemaTree {
  schemas: SchemaNode[]
}

/** One table or view and its column names, in the order the table declares them. */
export interface TableColumns {
  schema: string
  name: string
  columns: string[]
}

/** What the editor completes from: every table and view with its columns. */
export interface ColumnTree {
  /** The schema that unqualified tables land in. */
  defaultSchema: string
  /** Ordered by schema, then table name. */
  tables: TableColumns[]
}

/** One column of one table, as an engine's catalog query returns it. */
export interface ColumnRow {
  schema: string
  name: string
  column: string
}

/** One row per column, ordered by schema, table and position, folded into one entry per table. */
export function groupColumns(rows: ColumnRow[]): TableColumns[] {
  const tables: TableColumns[] = []
  for (const { schema, name, column } of rows) {
    const last = tables.at(-1)
    if (last && last.schema === schema && last.name === name) last.columns.push(column)
    else tables.push({ schema, name, columns: [column] })
  }
  return tables
}
