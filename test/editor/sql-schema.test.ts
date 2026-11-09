// What the editor completes from: the worker's column tree as the SQL language's schema option. Q2
import { CompletionContext } from '@codemirror/autocomplete'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { completionSchema } from '../../src/editor/sql-schema'

const SHOP = completionSchema({
  defaultSchema: 'public',
  tables: [
    { schema: 'public', name: 'users', columns: ['id', 'email'] },
    { schema: 'public', name: 'orders', columns: ['id', 'user_id'] },
    { schema: 'billing', name: 'invoices', columns: ['id', 'amount'] },
  ],
})

/** What the SQL language offers at the `|` of `doc`, asked for as Ctrl-Space would. */
function offered(doc: string): string[] {
  const pos = doc.indexOf('|')
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    extensions: [sql({ dialect: PostgreSQL, ...SHOP })],
  })
  const context = new CompletionContext(state, pos, true)
  return state
    .languageDataAt<(context: CompletionContext) => { options: { label: string }[] } | null>(
      'autocomplete',
      pos,
    )
    .flatMap((source) => source(context)?.options.map((option) => option.label) ?? [])
}

describe('completionSchema', () => {
  test('nests tables and their columns under their schema and names the default one', () => {
    expect(
      completionSchema({
        defaultSchema: 'public',
        tables: [
          { schema: 'public', name: 'users', columns: ['id', 'email'] },
          { schema: 'public', name: 'orders', columns: ['id', 'user_id'] },
          { schema: 'billing', name: 'invoices', columns: ['id'] },
        ],
      }),
    ).toEqual({
      schema: {
        public: { users: ['id', 'email'], orders: ['id', 'user_id'] },
        billing: { invoices: ['id'] },
      },
      defaultSchema: 'public',
    })
  })

  test('leaves the default schema unset when the connection has none', () => {
    expect(
      completionSchema({
        defaultSchema: '',
        tables: [{ schema: 'shop', name: 'items', columns: ['id'] }],
      }),
    ).toEqual({ schema: { shop: { items: ['id'] } }, defaultSchema: undefined })
  })

  test('an empty database has nothing to complete but keeps its default schema', () => {
    expect(completionSchema({ defaultSchema: 'main', tables: [] })).toEqual({
      schema: {},
      defaultSchema: 'main',
    })
  })
})

describe('completionSchema in the SQL language', () => {
  test('offers the default schema tables bare, and the other schemas by name', () => {
    const labels = offered('SELECT * FROM |')
    expect(labels).toEqual(expect.arrayContaining(['users', 'orders', 'billing']))
  })

  test("offers a schema's tables after its name", () => {
    expect(offered('SELECT * FROM billing.|')).toEqual(['invoices'])
  })

  test("offers a table's columns after its name, qualified or not", () => {
    expect(offered('SELECT * FROM users WHERE users.|')).toEqual(['id', 'email'])
    expect(offered('SELECT * FROM billing.invoices WHERE billing.invoices.|')).toEqual([
      'id',
      'amount',
    ])
  })

  test("offers an alias's table's columns", () => {
    expect(offered('SELECT * FROM users u WHERE u.|')).toEqual(['id', 'email'])
  })
})
