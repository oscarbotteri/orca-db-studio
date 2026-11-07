// Whether a statement sets its own row count. G1
const QUOTES = new Set(["'", '"', '`'])

/** Whether `LIMIT` appears outside strings, quoted names, comments and parentheses. */
export function hasOwnLimit(sql: string): boolean {
  let depth = 0
  let i = 0
  while (i < sql.length) {
    const char = sql[i] as string
    if (QUOTES.has(char)) {
      // A doubled quote closes and reopens, which this loop does too.
      const end = sql.indexOf(char, i + 1)
      i = end === -1 ? sql.length : end + 1
    } else if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
    } else if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
    } else if (char === '(') {
      depth++
      i++
    } else if (char === ')') {
      depth--
      i++
    } else if (/[A-Za-z_]/.test(char)) {
      let end = i + 1
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end] as string)) end++
      if (depth === 0 && sql.slice(i, end).toUpperCase() === 'LIMIT') return true
      i = end
    } else {
      i++
    }
  }
  return false
}
