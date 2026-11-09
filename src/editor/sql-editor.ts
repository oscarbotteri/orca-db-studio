// SQL editor on CodeMirror 6 (ADR 0001). Q1
import {
  autocompletion,
  completionKeymap,
  bracketMatching,
  Compartment,
  defaultKeymap,
  EditorState,
  drawSelection,
  EditorView,
  type Extension,
  highlightActiveLine,
  highlightActiveLineGutter,
  history,
  historyKeymap,
  keymap,
  lineNumbers,
  MariaSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  sql,
} from '../../vendor/codemirror.js'
import type { SqlDialect } from '../protocol'
import { columnCompletion } from './column-completion'
import type { CompletionSchema } from './sql-schema'
import { sqlTheme } from './sql-theme'
import type { TextChange } from './statements'

const DIALECTS = { sqlite: SQLite, postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL }

export interface SqlEditorOptions {
  parent: HTMLElement
  text: string
  readOnly: boolean
  dialect: SqlDialect
  onChange(text: string): void
  /** Mod-Enter: run the selection, or the statement under the cursor. */
  onRun(): void
}

export interface SqlEditor {
  text(): string
  /** The selected text, or undefined when nothing is selected. */
  selection(): string | undefined
  cursor(): number
  replace(text: string): void
  /** Applies an edit as typing would, so the document syncs it like any other change. */
  change(change: TextChange): void
  /** Completes the connection's tables and columns too; the text, cursor and undo history stay. */
  setCompletion(dialect: SqlDialect, schema: CompletionSchema | undefined): void
  /** Back to keywords only, in the dialect the editor has now. */
  clearSchema(): void
}

/** The SQL language, and with a schema also the columns of the tables a statement reads from. */
export function language(dialect: SqlDialect, schema: CompletionSchema | undefined): Extension {
  const sqlLanguage = sql({ dialect: DIALECTS[dialect], ...schema })
  if (!schema) return sqlLanguage
  const columns = columnCompletion(schema)
  return [sqlLanguage, EditorState.languageData.of(() => [{ autocomplete: columns }])]
}

function extensions(options: SqlEditorOptions, sqlLanguage: Compartment): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    bracketMatching(),
    history(),
    autocompletion(),
    sqlLanguage.of(language(options.dialect, undefined)),
    sqlTheme,
    EditorState.readOnly.of(options.readOnly),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          options.onRun()
          return true
        },
      },
      ...completionKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString())
    }),
  ]
}

export function createSqlEditor(options: SqlEditorOptions): SqlEditor {
  const sqlLanguage = new Compartment()
  let dialect = options.dialect
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({ doc: options.text, extensions: extensions(options, sqlLanguage) }),
  })
  return {
    text: () => view.state.doc.toString(),
    selection() {
      const { from, to } = view.state.selection.main
      return from === to ? undefined : view.state.sliceDoc(from, to)
    },
    cursor: () => view.state.selection.main.head,
    replace(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    },
    change(change) {
      view.dispatch({ changes: change })
    },
    setCompletion(next, schema) {
      dialect = next
      view.dispatch({ effects: sqlLanguage.reconfigure(language(dialect, schema)) })
    },
    clearSchema() {
      view.dispatch({ effects: sqlLanguage.reconfigure(language(dialect, undefined)) })
    },
  }
}
