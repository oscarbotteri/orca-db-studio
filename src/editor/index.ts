// Query document editor: a custom editor for .sql files. Q1, G1, ADR 0003
import type { SqlDialect } from '../protocol'
import { renderError, renderGrid } from './grid'
import { createSqlEditor } from './sql-editor'
import { connectionRef, isTableQuery, statementAt } from './statements'

const STYLE = `
  html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; background: var(--orca-background);
    color: var(--orca-foreground); font: 13px system-ui, sans-serif; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 10px;
    border-bottom: 1px solid var(--orca-border); }
  .toolbar button { font: inherit; color: inherit; background: transparent; cursor: pointer;
    border: 1px solid var(--orca-border); border-radius: 4px; padding: 2px 10px; }
  .toolbar .hint { opacity: .6; }
  .editor { flex: 0 0 40%; overflow: auto; border-bottom: 1px solid var(--orca-border); }
  .editor .cm-editor { height: 100%; background: var(--orca-background); color: var(--orca-foreground); }
  .result { flex: 1; overflow: auto; }
  .notice { padding: 6px 10px; border-bottom: 1px solid var(--orca-border); opacity: .8; }
  .error { padding: 10px; color: var(--orca-danger, #d33); white-space: pre-wrap;
    font-family: ui-monospace, monospace; }
  .message { padding: 10px; opacity: .7; }
  table.grid { border-collapse: collapse; font-family: ui-monospace, monospace; }
  .grid th, .grid td { border: 1px solid var(--orca-border); padding: 2px 8px; text-align: left;
    white-space: nowrap; }
  .grid th { position: sticky; top: 0; background: var(--orca-background); }
  .grid td.null { opacity: .5; font-style: italic; }
`

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function div(className: string): HTMLDivElement {
  const node = document.createElement('div')
  node.className = className
  return node
}

// The session's first message carries the theme and the file; nothing paints before it.
if (!orca.document) throw new Error('This file runs as a custom editor')
const doc = await orca.document.session()

const style = document.createElement('style')
style.textContent = STYLE
document.head.append(style)

const toolbar = div('toolbar')
const run = document.createElement('button')
run.textContent = 'Run'
const hint = div('hint')
hint.textContent = 'Runs the selection, or the statement under the cursor (Cmd/Ctrl+Enter)'
toolbar.append(run, hint)
const editorHost = div('editor')
const result = div('result')
document.body.append(toolbar, editorHost, result)

const ref = connectionRef(doc.value)
let dialect: SqlDialect | undefined
let failure: string | undefined
if (ref === undefined) {
  failure = 'This file names no connection. Its first line should be -- db-studio: connection=<ref>'
} else {
  try {
    dialect = (await orca.plugin.request('connection.info', { ref })).dialect
  } catch (error) {
    failure = errorMessage(error)
  }
}

const editor = createSqlEditor({
  parent: editorHost,
  text: doc.value,
  readOnly: doc.readOnly,
  dialect: dialect ?? 'sqlite',
  onChange: (text) => doc.change(text),
  onRun: () => void execute(),
})
doc.onReplace((value) => editor.replace(value))

async function execute(): Promise<void> {
  if (ref === undefined) return
  const sql = editor.selection() ?? statementAt(editor.text(), editor.cursor())
  if (!sql) {
    renderError(result, 'Nothing to run: put the cursor in a statement or select one.')
    return
  }
  run.disabled = true
  try {
    renderGrid(result, await orca.plugin.request('query.run', { ref, sql }))
  } catch (error) {
    renderError(result, errorMessage(error))
  } finally {
    run.disabled = false
  }
}

run.addEventListener('click', () => void execute())

if (failure !== undefined) {
  renderError(result, failure)
  run.disabled = true
} else if (isTableQuery(doc.value)) {
  // Only the query that opening a table writes runs at once; any other document waits for Run.
  void execute()
}
