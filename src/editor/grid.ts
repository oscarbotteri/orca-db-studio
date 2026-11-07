// Query result grid, cut off at the row limit, with the full-value panel. G1, G3
import type { QueryResult } from '../protocol'

export interface GridModel {
  headers: string[]
  /** `null` is SQL NULL, which the grid draws apart from the text "NULL". */
  rows: (string | null)[][]
  /** Shown above the grid when rows were cut off, or the count for a statement without rows. */
  notice: string | undefined
}

function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function gridModel(result: QueryResult): GridModel {
  let notice: string | undefined
  if (result.truncated) {
    notice = `Showing the first ${plural(result.rows.length, 'row')}. The row limit cut the result off.`
  } else if (result.columns.length === 0 && result.affectedRows !== undefined) {
    notice = `${plural(result.affectedRows, 'row')} affected.`
  }
  return { headers: result.columns, rows: result.rows.map((row) => row.map(cell)), notice }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Fills `into` with the grid; cell text goes in as text, never as markup. */
export function renderGrid(into: HTMLElement, result: QueryResult): void {
  const model = gridModel(result)
  const children: HTMLElement[] = []
  if (model.notice) children.push(element('div', 'notice', model.notice))
  if (model.headers.length > 0) {
    const table = element('table', 'grid')
    const head = table.createTHead().insertRow()
    for (const header of model.headers) head.append(element('th', '', header))
    const body = table.createTBody()
    for (const row of model.rows) {
      const tr = body.insertRow()
      for (const value of row) {
        tr.append(value === null ? element('td', 'null', 'NULL') : element('td', '', value))
      }
    }
    children.push(table)
  }
  into.replaceChildren(...children)
}

export function renderError(into: HTMLElement, message: string): void {
  into.replaceChildren(element('div', 'error', message))
}
