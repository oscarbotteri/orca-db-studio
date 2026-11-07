// Seam C: what the result grid shows, with and without the cut-off notice.
import { describe, expect, test } from 'vitest'
import { gridModel } from '../../src/editor/grid'

describe('gridModel', () => {
  test('shows the rows with no notice when nothing was cut off', () => {
    const model = gridModel({
      columns: ['id', 'name'],
      rows: [
        [1, 'a'],
        [2, null],
      ],
      truncated: false,
    })

    expect(model).toEqual({
      headers: ['id', 'name'],
      rows: [
        ['1', 'a'],
        ['2', null],
      ],
      notice: undefined,
    })
  })

  test('says how many rows it kept when the row limit cut the result off', () => {
    const model = gridModel({ columns: ['id'], rows: [[1], [2], [3]], truncated: true })

    expect(model.notice).toBe('Showing the first 3 rows. The row limit cut the result off.')
    expect(model.rows).toHaveLength(3)
  })

  test('reports the affected rows of a statement without rows', () => {
    expect(gridModel({ columns: [], rows: [], truncated: false, affectedRows: 1 }).notice).toBe(
      '1 row affected.',
    )
  })
})
