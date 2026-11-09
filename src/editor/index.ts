// Query document editor: a custom editor for .sql files. Q1, G1, ADR 0003
import { type ConnectionEntry, SAVED_CONNECTIONS_KEY, type SqlDialect } from '../protocol'
import { createConnectionChooser } from './connection-chooser'
import { chooserState, connectionEntries } from './connection-state'
import { BADGE_STYLE, createEnvironmentBadge } from './environment-badge'
import { createFullValuePanel, errorMessage } from './full-value-panel'
import { renderError, renderFullValue, renderGrid } from './grid'
import { createSqlEditor } from './sql-editor'
import { completionSchema } from './sql-schema'
import { PALETTE_STYLE } from './sql-theme'
import {
  changesSchema,
  connectionLineChange,
  connectionRef,
  isTableQuery,
  statementAt,
  statementCount,
} from './statements'

const STYLE = `
  :root { --surface: var(--orca-editor-surface, var(--orca-card)); }
  html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; background: var(--surface);
    color: var(--orca-foreground); font: 13px system-ui, sans-serif; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 10px;
    border-bottom: 1px solid var(--orca-border); }
  .toolbar button { font: inherit; color: inherit; background: transparent; cursor: pointer;
    border: 1px solid var(--orca-border); border-radius: 4px; padding: 2px 10px; }
  .toolbar .hint { opacity: .6; }
  .chooser { display: flex; gap: 8px; align-items: center; padding: 6px 10px;
    border-bottom: 1px solid var(--orca-border); }
  .chooser[hidden] { display: none; }
  .chooser select { font: inherit; color: inherit; background: var(--surface);
    border: 1px solid var(--orca-border); border-radius: 4px; padding: 2px 6px; }
  .chooser .notice { padding: 0; border: 0; }
  .editor { flex: 0 0 40%; overflow: auto; border-bottom: 1px solid var(--orca-border); }
  .editor .cm-editor { height: 100%; }
  .result { flex: 1; overflow: auto; }
  .fullvalue { flex: 0 1 35%; overflow: auto; border-top: 1px solid var(--orca-border); }
  .fullvalue[hidden] { display: none; }
  .fullvalue .value { margin: 0; padding: 6px 10px; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, monospace; }
  .fullvalue .null { padding: 6px 10px; opacity: .5; font-style: italic; }
  .grid td { cursor: default; }
  .grid td.selected { outline: 2px solid var(--orca-accent, #38f); outline-offset: -2px; }
  .notice { padding: 6px 10px; border-bottom: 1px solid var(--orca-border); opacity: .8; }
  .error { padding: 10px; color: var(--orca-danger, #d33); white-space: pre-wrap;
    font-family: ui-monospace, monospace; }
  .message { padding: 10px; opacity: .7; }
  table.grid { border-collapse: collapse; font-family: ui-monospace, monospace; }
  .grid th, .grid td { border: 1px solid var(--orca-border); padding: 2px 8px; text-align: left;
    white-space: nowrap; }
  .grid th { position: sticky; top: 0; background: var(--surface); }
  .grid td.null { opacity: .5; font-style: italic; }
`

const NO_CONNECTION = 'Choose a connection to run this file.'

function div(className: string): HTMLDivElement {
  const node = document.createElement('div')
  node.className = className
  return node
}

// The session's first message carries the theme and the file; nothing paints before it.
if (!orca.document) throw new Error('This file runs as a custom editor')
const doc = await orca.document.session()

const style = document.createElement('style')
style.textContent = STYLE + PALETTE_STYLE + BADGE_STYLE
document.head.append(style)

const toolbar = div('toolbar')
const run = document.createElement('button')
run.textContent = 'Run'
const hint = div('hint')
hint.textContent = 'Runs the selection, or the statement under the cursor (Cmd/Ctrl+Enter)'
const cancel = document.createElement('button')
cancel.textContent = 'Cancel'
cancel.hidden = true
const environmentBadge = createEnvironmentBadge()
toolbar.append(environmentBadge.badge, run, cancel, hint)
const editorHost = div('editor')
const result = div('result')
const fullValueHost = div('fullvalue')
document.body.append(environmentBadge.band, toolbar, editorHost, result, fullValueHost)

/** Names this document to the worker, which keeps its rows' full values under it (G3). */
const documentId = crypto.randomUUID()
// Best effort: a closing frame may not get the request out, so the worker also keeps few documents.
addEventListener('pagehide', () => {
  orca.plugin.request('query.release', { documentId }).catch(() => undefined)
})

const fullValuePanel = createFullValuePanel({
  element: fullValueHost,
  readCell: (row, column) => orca.plugin.request('query.cell', { documentId, row, column }),
  render: renderFullValue,
})

const ref = connectionRef(doc.value)
let entries: ConnectionEntry[] | undefined
try {
  entries = connectionEntries(await orca.plugin.request('connections.list'))
} catch {
  // Without the list the document's own line stands; connection.info below still checks it.
}

/** The band and badge follow the connection the document's first line names, as the registry has it now. */
function renderConnection(named: string | undefined): void {
  environmentBadge.show(entries?.find((entry) => entry.ref === named))
}

/** The last name the registry did not know, so a missing connection is looked for once, not per key. */
let missed: string | undefined

/** Only the latest reload may land: an earlier, slower answer is stale by then. */
let latestReload = 0

function showConnection(named: string | undefined): void {
  renderConnection(named)
  const known = entries?.some((entry) => entry.ref === named)
  if (known) missed = undefined
  if (known || named === undefined || named === missed) return
  // Saved after this document opened, or the first list failed: the registry may know it now.
  missed = named
  void reloadEntries()
}

const { needsChoice, notice } = chooserState(ref, entries, doc.readOnly)
let dialect: SqlDialect | undefined
let failure: string | undefined
if (ref !== undefined && !needsChoice) {
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
  onChange: (text) => {
    doc.change(text)
    // Choosing another connection writes its line, so the band and badge follow at once.
    showConnection(connectionRef(text))
  },
  onRun: () => void execute(),
})
doc.onReplace((value) => editor.replace(value))
showConnection(ref)

/** Only the latest load may land: an earlier, slower one is stale by then. */
let latestSchema = 0
/** The connection the editor last loaded a schema for. */
let loadedRef: string | undefined

/** The editor already completes keywords, so a schema that cannot load changes nothing. */
async function loadSchema(schemaRef: string): Promise<void> {
  const mine = ++latestSchema
  // Another connection's tables must not complete here, whether or not the load below succeeds.
  if (loadedRef !== undefined && loadedRef !== schemaRef) editor.clearSchema()
  loadedRef = schemaRef
  try {
    // The dialect comes with the schema: the line naming the connection may have been edited by hand.
    const [info, tree] = await Promise.all([
      orca.plugin.request('connection.info', { ref: schemaRef }),
      orca.plugin.request('editor.schema', { ref: schemaRef }),
    ])
    if (mine === latestSchema) editor.setCompletion(info.dialect, completionSchema(tree))
  } catch {
    // A connection that fails is already reported by connection.info.
  }
}

function loadOpenSchema(): void {
  if (ref !== undefined && dialect !== undefined && loadedRef !== ref) void loadSchema(ref)
}

let running = false
let connected = !needsChoice && failure === undefined
/** Only the latest choice may land: an earlier, slower one is stale by then. */
let latestChoice = 0

async function connect(chosen: string): Promise<void> {
  const mine = ++latestChoice
  let chosenDialect: SqlDialect
  try {
    chosenDialect = (await orca.plugin.request('connection.info', { ref: chosen })).dialect
  } catch (error) {
    if (mine !== latestChoice) return
    // The chooser stays up so another connection can be picked.
    chooser.setNotice(errorMessage(error))
    chooser.reset()
    return
  }
  if (mine !== latestChoice) return
  // The line is written only for a connection that works, so the file never keeps a broken one.
  editor.change(connectionLineChange(editor.text(), chosen))
  // The old connection's tables must not complete here while the new ones load.
  editor.setCompletion(chosenDialect, undefined)
  void loadSchema(chosen)
  chooser.element.hidden = true
  chooser.setNotice(undefined)
  result.replaceChildren()
  connected = true
  run.disabled = false
}

const chooser = createConnectionChooser(
  entries ?? [],
  (chosen) => void connect(chosen),
  doc.readOnly,
)
// A registered connection that fails to connect still offers the chooser beside the error.
chooser.element.hidden = connected
chooser.setNotice(notice)
toolbar.after(chooser.element)

/**
 * A saved connection was edited or deleted in the panel: its label changes in this document too.
 * Two signals, since Orca may not deliver the worker's event to an editor frame: the registry's
 * own storage key also reports the write.
 */
orca.plugin.on('connections.changed', () => void reloadEntries())
orca.storage.onDidChange(({ key }) => {
  if (key === SAVED_CONNECTIONS_KEY) void reloadEntries()
})

async function reloadEntries(): Promise<void> {
  const mine = ++latestReload
  let listed: ConnectionEntry[]
  try {
    listed = connectionEntries(await orca.plugin.request('connections.list'))
  } catch {
    // The list this document already has still stands.
    return
  }
  if (mine !== latestReload) return
  entries = listed
  chooser.setEntries(listed)
  renderConnection(connectionRef(editor.text()))
}

async function execute(): Promise<void> {
  // Mod-Enter bypasses the disabled button; a second run would race the first.
  if (running || !connected) return
  const ref = connectionRef(editor.text())
  if (ref === undefined) {
    // The line was removed after connecting, by undo or by hand: offer the chooser again.
    connected = false
    run.disabled = true
    chooser.element.hidden = false
    chooser.setNotice(NO_CONNECTION)
    return
  }
  const sql = editor.selection() ?? statementAt(editor.text(), editor.cursor())
  if (!sql) {
    renderError(result, 'Nothing to run: put the cursor in a statement or select one.')
    return
  }
  if (statementCount(sql) > 1) {
    renderError(result, 'Select a single statement: the database runs one statement at a time.')
    return
  }
  running = true
  run.disabled = true
  cancel.hidden = false
  fullValuePanel.close()
  // The old grid would still answer clicks, for rows the worker has already dropped.
  const message = div('message')
  message.textContent = 'Running…'
  result.replaceChildren(message)
  try {
    renderGrid(
      result,
      await orca.plugin.request('query.run', { ref, sql, documentId }),
      (row, column) => void fullValuePanel.show(row, column),
    )
    // The tables the editor completes from are stale, or are another connection's.
    if (ref !== loadedRef || changesSchema(sql)) void loadSchema(ref)
  } catch (error) {
    renderError(result, errorMessage(error))
  } finally {
    running = false
    run.disabled = false
    cancel.hidden = true
  }
}

cancel.addEventListener('click', () => {
  cancel.disabled = true
  // The running query.run rejects as cancelled; its handler above puts the message in the grid area.
  orca.plugin
    .request('query.cancel', { documentId })
    .catch((error: unknown) => renderError(result, errorMessage(error)))
    .finally(() => {
      cancel.disabled = false
    })
})

run.addEventListener('click', () => void execute())

if (needsChoice) {
  run.disabled = true
} else if (failure !== undefined) {
  renderError(result, failure)
  run.disabled = true
} else if (isTableQuery(doc.value)) {
  // Only the query that opening a table writes runs at once; any other document waits for Run.
  // The schema comes after it: a server connection runs one statement at a time, so it would
  // otherwise queue ahead of the rows the person opened the table to see.
  void execute().then(loadOpenSchema)
} else {
  loadOpenSchema()
}
