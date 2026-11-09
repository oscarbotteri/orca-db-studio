// Which SQL runs: the statement under the cursor, and the connection a document names.
import { describe, expect, test } from 'vitest'
import {
  connectionLineChange,
  connectionRef,
  changesSchema,
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

describe('connectionLineChange', () => {
  test('puts the line first when the file names no connection', () => {
    expect(connectionLineChange('SELECT 1', '/a.db')).toEqual({
      from: 0,
      to: 0,
      insert: '-- db-studio: connection=/a.db\n',
    })
  })

  test('writes the line into an empty file', () => {
    expect(connectionLineChange('', '/a.db')).toEqual({
      from: 0,
      to: 0,
      insert: '-- db-studio: connection=/a.db\n',
    })
  })

  test('replaces a stale line instead of stacking another', () => {
    expect(connectionLineChange('-- db-studio: connection=/gone.db\nSELECT 1', '/a.db')).toEqual({
      from: 0,
      to: 33,
      insert: '-- db-studio: connection=/a.db',
    })
  })

  test('replaces a CRLF header without touching its line ending', () => {
    const text = '-- db-studio: connection=/gone.db\r\nSELECT 1'
    const change = connectionLineChange(text, '/a.db')
    expect(text.slice(change.to, change.to + 2)).toBe('\r\n')
  })

  test('keeps a first line that is not a header', () => {
    const change = connectionLineChange('-- notes\nSELECT 1', '/a.db')
    expect(change.to).toBe(0)
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

describe('changesSchema', () => {
  test('is true for CREATE, ALTER, DROP and RENAME, in any case', () => {
    expect(changesSchema('CREATE TABLE t (id INT)')).toBe(true)
    expect(changesSchema('alter table t add column x int')).toBe(true)
    expect(changesSchema('Drop View v')).toBe(true)
    expect(changesSchema('RENAME TABLE a TO b')).toBe(true)
  })

  test('looks past the whitespace and comments ahead of the statement', () => {
    expect(changesSchema('  \n-- add the table\n/* v2 */ create table t (id int)')).toBe(true)
  })

  test('is false for statements that only read or change rows', () => {
    expect(changesSchema('SELECT 1')).toBe(false)
    expect(changesSchema('INSERT INTO t VALUES (1)')).toBe(false)
    expect(changesSchema('DELETE FROM t')).toBe(false)
    expect(changesSchema('-- drop table t\nSELECT 1')).toBe(false)
  })

  test('is false for a name that merely starts with the keyword', () => {
    expect(changesSchema('creators')).toBe(false)
    expect(changesSchema('')).toBe(false)
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
