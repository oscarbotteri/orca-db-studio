// Completes the columns of the tables a statement reads from, with no table in front. Q2
import type { CompletionSource } from '../../vendor/codemirror.js'
import type { CompletionSchema } from './sql-schema'
import { statementAt } from './statements'

interface TableRef {
  schema: string | undefined
  name: string
}

/** One token at a time: names, quoted names, strings and comments, then punctuation. */
const TOKEN =
  /`(?:[^`]|``)*`|"(?:[^"]|"")*"|\[[^\]]*\]|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[A-Za-z_][\w$]*|[.,()]|\S/g

/** Words that name a table next. */
const TABLE_CLAUSES = new Set(['from', 'join', 'update', 'into'])

/** Words that may follow a table name without being its alias. */
const NOT_ALIASES = new Set([
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'outer',
  'on',
  'using',
  'group',
  'order',
  'limit',
  'offset',
  'having',
  'union',
  'intersect',
  'except',
  'set',
  'values',
  'window',
  'returning',
  'select',
  'for',
  'lateral',
  'straight_join',
])

function tokens(sql: string): string[] {
  return (sql.match(TOKEN) ?? []).filter((token) => !/^(?:--|\/\*|')/.test(token))
}

/** The name a token spells, without its quotes; undefined when the token is not a name. */
function nameOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  if (/^[`"]/.test(token)) {
    const quote = token[0] as string
    return token.slice(1, -1).replaceAll(quote + quote, quote)
  }
  if (token.startsWith('[')) return token.slice(1, -1)
  return /^[A-Za-z_]/.test(token) ? token : undefined
}

/** The tables a statement names after FROM, JOIN, UPDATE and INTO, with a FROM's comma list. */
function referencedTables(sql: string): TableRef[] {
  const all = tokens(sql)
  const found: TableRef[] = []
  all.forEach((token, start) => {
    const clause = token.toLowerCase()
    if (!TABLE_CLAUSES.has(clause)) return
    let i = start + 1
    for (;;) {
      const path: string[] = []
      for (;;) {
        const part = nameOf(all[i])
        if (part === undefined) break
        path.push(part)
        i++
        if (all[i] !== '.') break
        i++
      }
      if (path.length === 0) return
      found.push({ schema: path.at(-2), name: path.at(-1) as string })
      if (all[i]?.toLowerCase() === 'as') i++
      const alias = all[i]
      if (
        alias !== undefined &&
        nameOf(alias) !== undefined &&
        !NOT_ALIASES.has(alias.toLowerCase())
      )
        i++
      if (clause !== 'from' || all[i] !== ',') return
      i++
    }
  })
  return found
}

function lookup<T>(map: Record<string, T> | undefined, name: string): T | undefined {
  if (!map) return undefined
  if (Object.hasOwn(map, name)) return map[name]
  const lower = name.toLowerCase()
  const key = Object.keys(map).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : map[key]
}

function columnsOf(table: TableRef, { schema, defaultSchema }: CompletionSchema): string[] {
  const named = table.schema ?? defaultSchema
  if (named !== undefined) return lookup(lookup(schema, named), table.name) ?? []
  for (const tables of Object.values(schema)) {
    const columns = lookup(tables, table.name)
    if (columns) return columns
  }
  return []
}

/** The columns of every table the statement reads from, each name once, in table order. */
export function columnsFor(statement: string, schema: CompletionSchema): string[] {
  return [...new Set(referencedTables(statement).flatMap((table) => columnsOf(table, schema)))]
}

/** A name that follows these words is a table's, not a column's. */
const TABLE_POSITION = /\b(?:from|join|update|into)\s+$/i

export function columnCompletion(schema: CompletionSchema): CompletionSource {
  return (context) => {
    const word = context.matchBefore(/[\w$]*/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    const before = context.state.sliceDoc(Math.max(0, word.from - 40), word.from)
    // After a dot the language completes the table's own columns; inside a quote it is a name.
    if (/[.`"[]$/.test(before) || TABLE_POSITION.test(before)) return null
    const statement = statementAt(context.state.doc.toString(), context.pos)
    const columns = statement ? columnsFor(statement, schema) : []
    if (columns.length === 0) return null
    return {
      from: word.from,
      options: columns.map((label) => ({ label, type: 'property', boost: 10 })),
      validFor: /^[\w$]*$/,
    }
  }
}
