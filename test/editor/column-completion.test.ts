// Columns without a table in front: the ones of the tables the statement reads from. Q2
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { columnCompletion, columnsFor } from '../../src/editor/column-completion'
import { completionSchema } from '../../src/editor/sql-schema'

const SHOP = completionSchema({
  defaultSchema: 'shop',
  tables: [
    { schema: 'shop', name: 'customers', columns: ['id', 'name', 'email'] },
    { schema: 'shop', name: 'orders', columns: ['id', 'customer_id', 'status'] },
    { schema: 'archive', name: 'orders', columns: ['id', 'archived_at'] },
  ],
})

describe('columnsFor', () => {
  test('a quoted, schema-qualified table', () => {
    expect(columnsFor('SELECT * FROM `shop`.`customers` WHERE e', SHOP)).toEqual([
      'id',
      'name',
      'email',
    ])
  })

  test('an unqualified table lives in the default schema', () => {
    expect(columnsFor('SELECT * FROM orders WHERE s', SHOP)).toEqual([
      'id',
      'customer_id',
      'status',
    ])
  })

  test('a table of another schema, qualified', () => {
    expect(columnsFor('select * from archive.orders where a', SHOP)).toEqual(['id', 'archived_at'])
  })

  test('every table of a join, aliased or not, each column once', () => {
    expect(
      columnsFor('SELECT * FROM customers c JOIN orders AS o ON o.customer_id = c.id WHERE ', SHOP),
    ).toEqual(['id', 'name', 'email', 'customer_id', 'status'])
  })

  test('every table of a comma list', () => {
    expect(columnsFor('SELECT * FROM customers c, orders o WHERE ', SHOP)).toEqual([
      'id',
      'name',
      'email',
      'customer_id',
      'status',
    ])
  })

  test('a table in a subquery', () => {
    expect(columnsFor('SELECT * FROM (SELECT * FROM customers) t WHERE ', SHOP)).toEqual([
      'id',
      'name',
      'email',
    ])
  })

  test('the table an UPDATE or INSERT names', () => {
    expect(columnsFor('UPDATE customers SET ', SHOP)).toEqual(['id', 'name', 'email'])
    expect(columnsFor('INSERT INTO "shop"."orders" (', SHOP)).toEqual([
      'id',
      'customer_id',
      'status',
    ])
  })

  test('ignores table names inside strings and comments', () => {
    expect(columnsFor("SELECT 'from orders' FROM customers -- join orders\n WHERE ", SHOP)).toEqual(
      ['id', 'name', 'email'],
    )
  })

  test('matches a name regardless of case, and offers nothing for an unknown table', () => {
    expect(columnsFor('SELECT * FROM CUSTOMERS WHERE ', SHOP)).toEqual(['id', 'name', 'email'])
    expect(columnsFor('SELECT * FROM nowhere WHERE ', SHOP)).toEqual([])
    expect(columnsFor('SELECT 1', SHOP)).toEqual([])
  })
})

/** What the SQL language and the column source offer together at the `|` of `doc`. */
function offered(doc: string, explicit = false): string[] {
  const pos = doc.indexOf('|')
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    extensions: [
      sql({ dialect: PostgreSQL, ...SHOP }),
      EditorState.languageData.of(() => [{ autocomplete: columnCompletion(SHOP) }]),
    ],
  })
  const context = new CompletionContext(state, pos, explicit)
  return state
    .languageDataAt<(context: CompletionContext) => { options: { label: string }[] } | null>(
      'autocomplete',
      pos,
    )
    .flatMap((source) => source(context)?.options.map((option) => option.label) ?? [])
}

describe('columnCompletion', () => {
  test('offers the columns of the table being read while a word is typed', () => {
    const labels = offered('SELECT * FROM `shop`.`customers` WHERE e|')
    expect(labels).toEqual(expect.arrayContaining(['email', 'name', 'id']))
  })

  test('offers them with no word typed only when asked for', () => {
    expect(offered('SELECT * FROM customers WHERE |')).not.toContain('email')
    expect(offered('SELECT * FROM customers WHERE |', true)).toContain('email')
  })

  test('leaves what follows a dot to the language, so nothing is offered twice', () => {
    expect(offered('SELECT * FROM customers c WHERE c.|', true)).toEqual(['id', 'name', 'email'])
  })

  test('offers no columns where a table name goes, or inside a quoted name', () => {
    expect(offered('SELECT * FROM cust|')).not.toContain('email')
    expect(offered('SELECT * FROM `shop`.`cust|`')).not.toContain('email')
  })
})
