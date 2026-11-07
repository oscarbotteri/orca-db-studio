// Which SQL runs: the statement under the cursor, and the connection a document names.
import { describe, expect, test } from 'vitest'
import {
  connectionRef,
  isTableQuery,
  statementAt,
  statementCount,
} from '../../src/editor/statements'

describe('connectionRef', () => {
  test('reads the connection from the first line', () => {
    expect(connectionRef('-- db-studio: connection=/data/my shop.db\nSELECT 1')).toBe(
      '/data/my shop.db',
    )
  })

  test('is undefined when the first line does not name one', () => {
    expect(connectionRef('SELECT 1\n-- db-studio: connection=/a.db')).toBeUndefined()
    expect(connectionRef('')).toBeUndefined()
  })
})

describe('statementAt', () => {
  const text = 'SELECT 1;\nSELECT 2;\n\nSELECT 3'

  test('picks the statement the cursor is in', () => {
    expect(statementAt(text, 3)).toBe('SELECT 1')
    expect(statementAt(text, 14)).toBe('SELECT 2')
    expect(statementAt(text, text.length)).toBe('SELECT 3')
  })

  test('a cursor right after a semicolon still belongs to that statement', () => {
    expect(statementAt(text, 9)).toBe('SELECT 1')
  })

  test('a cursor between statements picks the one before it', () => {
    expect(statementAt(text, 20)).toBe('SELECT 2')
  })

  test('ignores semicolons in strings, quoted names and comments', () => {
    const sql = 'SELECT \'a;b\', "c;d" -- e;f\nFROM t /* g;h */ WHERE x = 1; SELECT 2'
    expect(statementAt(sql, 5)).toBe('SELECT \'a;b\', "c;d" -- e;f\nFROM t /* g;h */ WHERE x = 1')
  })

  test('keeps the header comment with the first statement', () => {
    expect(statementAt('-- db-studio: connection=/a.db\nSELECT 1', 40)).toBe(
      '-- db-studio: connection=/a.db\nSELECT 1',
    )
  })

  test('is undefined when there is nothing but whitespace', () => {
    expect(statementAt('  \n ', 1)).toBeUndefined()
    expect(statementAt('', 0)).toBeUndefined()
  })
})

describe('isTableQuery', () => {
  test('accepts what opening a table writes', () => {
    expect(
      isTableQuery('-- db-studio: connection=/a.db\nSELECT * FROM "main"."t" LIMIT 100\n'),
    ).toBe(true)
  })

  test('refuses anything the person wrote, so it never runs on open', () => {
    expect(isTableQuery('-- db-studio: connection=/a.db\nDELETE FROM t')).toBe(false)
    expect(isTableQuery('-- db-studio: connection=/a.db\nSELECT * FROM big a, big b LIMIT 1')).toBe(
      false,
    )
    expect(
      isTableQuery('-- db-studio: connection=/a.db\nSELECT * FROM t LIMIT 1; DROP TABLE t'),
    ).toBe(false)
    expect(isTableQuery('SELECT * FROM t LIMIT 1')).toBe(false)
  })
})

describe('statements that are only comments', () => {
  test('a trailing comment is not a statement', () => {
    expect(statementAt('select 1;\n-- todo', 17)).toBe('select 1')
    expect(statementAt('select 1;\n/* later */', 20)).toBe('select 1')
  })

  test('a document of comments alone has nothing to run', () => {
    expect(statementAt('-- db-studio: connection=/a.db\n-- todo', 38)).toBeUndefined()
  })
})

describe('statementCount', () => {
  test('counts statements, not semicolons or comments', () => {
    expect(statementCount('SELECT 1')).toBe(1)
    expect(statementCount('SELECT 1; -- done')).toBe(1)
    expect(statementCount("DELETE FROM a; SELECT ';' FROM b;")).toBe(2)
  })
})
