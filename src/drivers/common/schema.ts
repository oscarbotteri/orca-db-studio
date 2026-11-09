// The tables and views a connection lists, as the explorer shows them.

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
