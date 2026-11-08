// Seam C: what the result grid shows, with and without the cut-off notice.
import { describe, expect, test } from 'vitest'
import { fullValueModel, gridModel } from '../../src/editor/grid'

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

describe('fullValueModel', () => {
  test('shows plain text as it is', () => {
    expect(fullValueModel({ text: 'line one\nline two', cut: false })).toEqual({
      text: 'line one\nline two',
      isNull: false,
      notice: undefined,
    })
  })

  test('pretty-prints a JSON object or array', () => {
    expect(fullValueModel({ text: '{"a":1,"b":[true,null]}', cut: false }).text).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    )
    expect(fullValueModel({ text: '[1,2]', cut: false }).text).toBe('[\n  1,\n  2\n]')
  })

  test('leaves text that only looks like JSON alone', () => {
    expect(fullValueModel({ text: '{not json', cut: false }).text).toBe('{not json')
    expect(fullValueModel({ text: '42', cut: false }).text).toBe('42')
    expect(fullValueModel({ text: '"quoted"', cut: false }).text).toBe('"quoted"')
  })

  test('marks SQL NULL apart from the text "NULL"', () => {
    expect(fullValueModel({ text: null, cut: false })).toMatchObject({ isNull: true, text: '' })
    expect(fullValueModel({ text: 'NULL', cut: false }).isNull).toBe(false)
  })

  test('says when the value was too large and was cut, and does not format the cut JSON', () => {
    const model = fullValueModel({ text: '{"a":"xxxx', cut: true })

    expect(model.notice).toBe(
      'Showing the first part of the value: it is too large to show in full and was cut.',
    )
    expect(model.text).toBe('{"a":"xxxx')
  })
})
