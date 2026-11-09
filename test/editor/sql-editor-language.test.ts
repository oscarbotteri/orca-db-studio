// The language the editor installs, built from the bundle the frame loads. Q2
import { CompletionContext } from '@codemirror/autocomplete'
import { describe, expect, test } from 'vitest'
import { EditorState } from '../../vendor/codemirror.js'
import { language } from '../../src/editor/sql-editor'
import { completionSchema } from '../../src/editor/sql-schema'

const SHOP = completionSchema({
  defaultSchema: 'shop',
  tables: [{ schema: 'shop', name: 'customers', columns: ['id', 'name', 'email'] }],
})

type Source = (context: CompletionContext) => { options: { label: string }[] } | null

/** What the editor offers at the `|` of `doc`, as typing a word would ask for it. */
function offered(doc: string, schema: typeof SHOP | undefined): string[] {
  const pos = doc.indexOf('|')
  const state = EditorState.create({
    doc: doc.replace('|', ''),
    extensions: [language('mariadb', schema)],
  })
  const context = new CompletionContext(state as never, pos, false)
  return state
    .languageDataAt<Source>('autocomplete', pos)
    .flatMap((source) => source(context)?.options.map((option) => option.label) ?? [])
}

describe('language', () => {
  test('with a schema it offers tables, and the columns of the table being read', () => {
    expect(offered('SELECT * FROM cus|', SHOP)).toContain('customers')
    expect(offered('SELECT * FROM `shop`.`customers` WHERE e|', SHOP)).toContain('email')
  })

  test('without a schema it completes keywords only', () => {
    const labels = offered('SELECT * FROM `shop`.`customers` WHERE e|', undefined)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain('email')
  })
})
