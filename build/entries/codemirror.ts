// Editor frame bundle: CodeMirror 6 with the SQL dialects (ADR 0001).
export { autocompletion, completionKeymap } from '@codemirror/autocomplete'
export { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
export {
  MariaSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  sql,
} from '@codemirror/lang-sql'
export { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
export { EditorState } from '@codemirror/state'
export { EditorView, keymap, lineNumbers } from '@codemirror/view'
