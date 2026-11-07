// Which SQL a run covers. Q1
const HEADER_PREFIX = '-- db-studio: connection='
const HEADER = /^-- db-studio: connection=(.+)$/

/** The connection a query document names on its first line. */
export function connectionRef(text: string): string | undefined {
  const firstLine = text.split('\n', 1)[0] ?? ''
  return HEADER.exec(firstLine.trimEnd())?.[1]
}

export interface TextChange {
  from: number
  to: number
  insert: string
}

/** The edit that makes `ref` the document's connection: a new first line, or the stale one replaced. */
export function connectionLineChange(text: string, ref: string): TextChange {
  const line = `-- db-studio: connection=${ref}`
  const firstLine = text.split('\n', 1)[0] ?? ''
  if (firstLine.startsWith(HEADER_PREFIX)) return { from: 0, to: firstLine.length, insert: line }
  return { from: 0, to: 0, insert: `${line}\n` }
}

interface Span {
  start: number
  /** Past the closing semicolon, when there is one. */
  end: number
}

function closingIndex(text: string, from: number, closer: string): number {
  const at = text.indexOf(closer, from)
  return at === -1 ? text.length : at + closer.length
}

/** Splits at semicolons outside strings, quoted names and comments. */
function spans(text: string): Span[] {
  const found: Span[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === "'" || char === '"' || char === '`') {
      // A doubled quote is an escaped one: it closes and reopens, which this loop does too.
      i = closingIndex(text, i + 1, char)
    } else if (char === '-' && text[i + 1] === '-') {
      i = closingIndex(text, i, '\n')
    } else if (char === '/' && text[i + 1] === '*') {
      i = closingIndex(text, i + 2, '*/')
    } else if (char === ';') {
      found.push({ start, end: i + 1 })
      start = i + 1
      i++
    } else {
      i++
    }
  }
  found.push({ start, end: text.length })
  return found
}

function body(text: string, span: Span): string {
  const sql = text.slice(span.start, span.end).replace(/;$/, '').trim()
  // A span of comments alone is not a statement.
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g, '').trim() ? sql : ''
}

/** How many statements the text holds, ignoring blank and comment-only ones. */
export function statementCount(text: string): number {
  return spans(text).filter((span) => body(text, span)).length
}

/** The statement the cursor is in, or the one before it when the cursor sits between statements. */
export function statementAt(text: string, cursor: number): string | undefined {
  const all = spans(text)
  const inside = all.findIndex((s) => cursor >= s.start && cursor <= s.end)
  const span = all[inside]
  // Blank space ahead of a statement belongs to the one before it.
  const leading = span
    ? span.start + (/^\s*/.exec(text.slice(span.start, span.end))?.[0].length ?? 0)
    : 0
  const first = inside > 0 && cursor < leading ? inside - 1 : inside
  for (let i = inside === -1 ? all.length - 1 : first; i >= 0; i--) {
    const candidate = all[i]
    const sql = candidate && body(text, candidate)
    if (sql) return sql
  }
  return undefined
}

// One quoted name, optionally schema-qualified: no joins, no lists, nothing the person wrote.
const QUOTED_NAME = '(?:"(?:[^"\\n]|"")+"|`(?:[^`\\n]|``)+`)'
const TABLE_QUERY = new RegExp(
  `^-- db-studio: connection=.+\\nSELECT \\* FROM ${QUOTED_NAME}(?:\\.${QUOTED_NAME})? LIMIT \\d+\\n?$`,
)

/** Whether the document is exactly what opening a table writes: safe to run on open. */
export function isTableQuery(text: string): boolean {
  return TABLE_QUERY.test(text)
}
