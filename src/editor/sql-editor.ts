// SQL editor on CodeMirror 6 (ADR 0001). Q1
import {
  autocompletion,
  completionKeymap,
  bracketMatching,
  defaultKeymap,
  EditorState,
  drawSelection,
  EditorView,
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
}

export function createSqlEditor(options: SqlEditorOptions): SqlEditor {
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        history(),
        autocompletion(),
        sql({ dialect: DIALECTS[options.dialect] }),
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
      ],
    }),
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
  }
}
