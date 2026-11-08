// Seam C: which selection the full-value panel shows. The element is a stand-in: vitest runs in Node.
import { describe, expect, test } from 'vitest'
import { createFullValuePanel } from '../../src/editor/full-value-panel'
import type { FullValueModel } from '../../src/editor/grid'
import type { CellValue } from '../../src/protocol'

type State = FullValueModel | { error: string }

function setup(readCell: (row: number, column: number) => Promise<CellValue>) {
  const element = { hidden: true, cleared: 0, replaceChildren: () => void element.cleared++ }
  const rendered: State[] = []
  const panel = createFullValuePanel({
    element: element as unknown as HTMLElement,
    readCell,
    render: (_into, state) => void rendered.push(state),
  })
  return { element, rendered, panel }
}

describe('createFullValuePanel', () => {
  test('starts hidden and shows the selected cell', async () => {
    const { element, rendered, panel } = setup(async () => ({ text: 'hello', cut: false }))
    expect(element.hidden).toBe(true)

    await panel.show(0, 1)

    expect(element.hidden).toBe(false)
    expect(rendered).toEqual([{ text: 'hello', isNull: false, notice: undefined }])
  })

  test('shows why a cell could not be read', async () => {
    const { element, rendered, panel } = setup(async () => {
      throw new Error('The result is no longer available: run the query again.')
    })

    await panel.show(0, 0)

    expect(element.hidden).toBe(false)
    expect(rendered).toEqual([{ error: 'The result is no longer available: run the query again.' }])
  })

  test('an earlier, slower selection does not land after a later one', async () => {
    const resolvers: ((value: CellValue) => void)[] = []
    const { rendered, panel } = setup(() => new Promise((resolve) => resolvers.push(resolve)))

    const first = panel.show(0, 0)
    const second = panel.show(1, 0)
    resolvers[1]?.({ text: 'second', cut: false })
    resolvers[0]?.({ text: 'first', cut: false })
    await Promise.all([first, second])

    expect(rendered).toMatchObject([{ text: 'second' }])
  })

  test('closing hides and empties the panel, and drops a selection still being read', async () => {
    let resolve: (value: CellValue) => void = () => undefined
    const { element, rendered, panel } = setup(() => new Promise((r) => (resolve = r)))

    const pending = panel.show(0, 0)
    panel.close()
    resolve({ text: 'late', cut: false })
    await pending

    expect(element.hidden).toBe(true)
    expect(element.cleared).toBe(1)
    expect(rendered).toEqual([])
  })
})
