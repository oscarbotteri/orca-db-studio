// The panel under the grid: which cell it shows, and which answer may still land. G3
import type { CellValue } from '../protocol'
import { type FullValueModel, fullValueModel } from './grid'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface FullValuePanelOptions {
  element: HTMLElement
  readCell(row: number, column: number): Promise<CellValue>
  render(into: HTMLElement, state: FullValueModel | { error: string }): void
}

export interface FullValuePanel {
  /** Shows the cell's full value; an earlier, slower selection never lands after a later one. */
  show(row: number, column: number): Promise<void>
  /** Hides the panel, and drops any selection still being read. */
  close(): void
}

export function createFullValuePanel({
  element,
  readCell,
  render,
}: FullValuePanelOptions): FullValuePanel {
  let latestSelection = 0
  element.hidden = true

  return {
    async show(row, column) {
      const mine = ++latestSelection
      let state: FullValueModel | { error: string }
      try {
        state = fullValueModel(await readCell(row, column))
      } catch (error) {
        state = { error: errorMessage(error) }
      }
      if (mine !== latestSelection) return
      element.hidden = false
      render(element, state)
    },
    close() {
      latestSelection++
      element.hidden = true
      element.replaceChildren()
    },
  }
}
