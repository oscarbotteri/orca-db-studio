// Query result grid, cut off at the row limit, with the full-value panel. G1, G3
import type { CellValue, QueryResult } from '../protocol'

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

export interface FullValueModel {
  /** Pretty-printed when the value is a JSON object or array. */
  text: string
  isNull: boolean
  /** Set when the value was cut at 1 MiB. */
  notice: string | undefined
}

function prettyJson(text: string): string {
  if (!/^\s*[{[]/.test(text)) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function fullValueModel(value: CellValue): FullValueModel {
  if (value.text === null) return { text: '', isNull: true, notice: undefined }
  if (value.cut) {
    return {
      text: value.text,
      isNull: false,
      notice: 'Showing the first part of the value: it is over 1 MiB and was cut.',
    }
  }
  return { text: prettyJson(value.text), isNull: false, notice: undefined }
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
export function renderGrid(
  into: HTMLElement,
  result: QueryResult,
  onSelect: (row: number, column: number) => void,
): void {
  const model = gridModel(result)
  const children: HTMLElement[] = []
  if (model.notice) children.push(element('div', 'notice', model.notice))
  if (model.headers.length > 0) {
    const table = element('table', 'grid')
    const head = table.createTHead().insertRow()
    for (const header of model.headers) head.append(element('th', '', header))
    const body = table.createTBody()
    model.rows.forEach((row, rowIndex) => {
      const tr = body.insertRow()
      for (const value of row) {
        tr.append(value === null ? element('td', 'null', 'NULL') : element('td', '', value))
      }
      tr.dataset.row = String(rowIndex)
    })
    table.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return
      const td = event.target.closest('td')
      const tr = td?.closest('tr')
      if (!td || !tr || tr.dataset.row === undefined) return
      table.querySelector('td.selected')?.classList.remove('selected')
      td.classList.add('selected')
      onSelect(Number(tr.dataset.row), td.cellIndex)
    })
    children.push(table)
  }
  into.replaceChildren(...children)
}

export function renderError(into: HTMLElement, message: string): void {
  into.replaceChildren(element('div', 'error', message))
}

/** The panel under the grid: the selected cell's full value, or why it could not be read. */
export function renderFullValue(
  into: HTMLElement,
  state: FullValueModel | { error: string },
): void {
  if ('error' in state) {
    into.replaceChildren(element('div', 'error', state.error))
    return
  }
  const children: HTMLElement[] = []
  if (state.notice) children.push(element('div', 'notice', state.notice))
  children.push(state.isNull ? element('div', 'null', 'NULL') : element('pre', 'value', state.text))
  into.replaceChildren(...children)
}
