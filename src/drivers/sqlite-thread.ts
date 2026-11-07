// One SQLite session, run in a worker_threads thread because node:sqlite is synchronous.
// Loaded by Node directly, not by Orca's loader: erasable TypeScript only, type-only imports.
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { StatementSync } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import type { ColumnMeta, Row, SchemaNode, SchemaTree } from './types.ts'

export interface ThreadOps {
  open: { input: Record<string, never>; output: null }
  listObjects: { input: Record<string, never>; output: SchemaTree }
  query: {
    input: { sql: string }
    output: {
      cursorId: number | undefined
      columns: ColumnMeta[]
      affectedRows: number | undefined
    }
  }
  fetch: { input: { cursorId: number; count: number }; output: Row[] }
  closeCursor: { input: { cursorId: number }; output: null }
}

export type ThreadOp = keyof ThreadOps

export interface ThreadRequest {
  id: number
  op: ThreadOp
  input: unknown
}

export type ThreadReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string }

const HEADER = 'SQLite format 3\0'

const path: string = workerData.path
const cursors = new Map<number, Iterator<unknown>>()
let nextCursorId = 1
let db: DatabaseSync | undefined

function checkFile(file: string): void {
  let size: number
  try {
    const stat = statSync(file)
    if (!stat.isFile()) throw new Error(`${file} is not a file`)
    size = stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No file at ${file}`)
    throw error
  }
  if (size === 0) return
  const header = Buffer.alloc(HEADER.length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, header, 0, HEADER.length, 0)
  } finally {
    closeSync(fd)
  }
  if (header.toString('latin1') !== HEADER) throw new Error(`${file} is not a SQLite database`)
}

function database(): DatabaseSync {
  if (!db) {
    checkFile(path)
    db = new DatabaseSync(path)
  }
  return db
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function listObjects(): SchemaTree {
  const schemas: SchemaNode[] = []
  for (const { name } of database().prepare('PRAGMA database_list').all()) {
    const schema = String(name)
    const rows = database()
      .prepare(
        `SELECT name, type FROM ${quoteIdent(schema)}.sqlite_schema
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
    schemas.push({
      name: schema,
      objects: rows.map((row) => ({
        name: String(row.name),
        kind: row.type === 'view' ? 'view' : 'table',
      })),
    })
  }
  return { schemas }
}

function query(sql: string): ThreadOps['query']['output'] {
  const statement: StatementSync = database().prepare(sql)
  const columns = statement.columns().map((c) => ({ name: c.name, type: c.type ?? '' }))
  if (columns.length === 0) {
    const { changes } = statement.run()
    return { cursorId: undefined, columns, affectedRows: Number(changes) }
  }
  statement.setReturnArrays(true)
  const cursorId = nextCursorId++
  cursors.set(cursorId, statement.iterate())
  return { cursorId, columns, affectedRows: undefined }
}

function fetch(cursorId: number, count: number): Row[] {
  const cursor = cursors.get(cursorId)
  if (!cursor) return []
  const rows: Row[] = []
  while (rows.length < count) {
    const next = cursor.next()
    if (next.done) {
      cursors.delete(cursorId)
      break
    }
    rows.push(next.value as Row)
  }
  return rows
}

function closeCursor(cursorId: number): null {
  cursors.get(cursorId)?.return?.()
  cursors.delete(cursorId)
  return null
}

function handle(op: ThreadOp, input: unknown): unknown {
  switch (op) {
    case 'open':
      database()
      return null
    case 'listObjects':
      return listObjects()
    case 'query':
      return query((input as ThreadOps['query']['input']).sql)
    case 'fetch': {
      const { cursorId, count } = input as ThreadOps['fetch']['input']
      return fetch(cursorId, count)
    }
    case 'closeCursor':
      return closeCursor((input as ThreadOps['closeCursor']['input']).cursorId)
  }
}

parentPort?.on('message', ({ id, op, input }: ThreadRequest) => {
  let reply: ThreadReply
  try {
    reply = { id, ok: true, value: handle(op, input) }
  } catch (error) {
    reply = { id, ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(reply)
})
