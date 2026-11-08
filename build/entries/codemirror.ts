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
export { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
export { tags } from '@lezer/highlight'
export { EditorState, type Extension } from '@codemirror/state'
export {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
