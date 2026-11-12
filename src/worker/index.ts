import type { OrcaWorkerApi } from 'orca/worker'
import {
  WORKSPACE_QUESTION_KEY,
  type NewQueryQuestion,
  SQLITE_FORM_REQUEST_KEY,
  type WorkspaceChoice,
} from '../protocol'
import { type Connections, createConnections } from './connections'
import { newQuery, openTable } from './documents'
import { RESULT_CEILING_ROWS } from './query-engine'
import { findSqliteFiles } from './sqlite-discovery'

const DEFAULT_ROW_LIMIT = 100

/** A worker answer expires after 120 s, so no setting may ask for more than 110. */
const MAX_TIMEOUT_SECONDS = 110
const DEFAULT_TIMEOUT_SECONDS = 30

/** A number setting of at least 1, capped at `max`; anything else is the default. */
function clampSetting(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && value >= 1 ? Math.min(value, max) : fallback
}

let connections: Connections | undefined

export default function activate(orca: OrcaWorkerApi): void {
  const registry = createConnections(orca)
  connections = registry
  orca.panels.handle('connections.list', () => registry.list())
  orca.panels.handle('sqlite.findFiles', async () => ({ files: await findSqliteFiles(orca) }))
  orca.panels.handle('connection.save', (input) => registry.save(input))
  orca.panels.handle('connection.test', async (input) => {
    await registry.test(input)
    return {}
  })
  orca.panels.handle('connection.get', ({ ref }) => registry.get(ref))
  orca.panels.handle('connection.delete', async ({ ref }) => {
    await registry.delete(ref)
    return {}
  })
  orca.panels.handle('explorer.listObjects', ({ ref }) => registry.listObjects(ref))
  orca.panels.handle('editor.schema', ({ ref }) => registry.listColumns(ref))
  orca.panels.handle('table.open', (input) => openTable(orca, registry, input))
  orca.panels.handle('query.new', ({ workspaceId }) => newQuery(orca, workspaceId))
  orca.panels.handle('connection.info', async ({ ref }) => ({
    dialect: await registry.dialect(ref),
  }))
  orca.panels.handle('query.run', async ({ ref, sql, documentId }) => {
    const rowLimit = clampSetting(
      await orca.settings.get('rowLimit'),
      RESULT_CEILING_ROWS,
      DEFAULT_ROW_LIMIT,
    )
    const seconds = clampSetting(
      await orca.settings.get('queryTimeoutSeconds'),
      MAX_TIMEOUT_SECONDS,
      DEFAULT_TIMEOUT_SECONDS,
    )
    return registry.runQuery(ref, sql, { documentId, rowLimit, timeoutMs: seconds * 1000 })
  })
  orca.panels.handle('query.cancel', async ({ documentId }) => {
    await registry.cancelQuery(documentId)
    return {}
  })
  orca.panels.handle('query.cell', ({ documentId, row, column }) =>
    registry.queryCell(documentId, row, column),
  )
  orca.panels.handle('query.release', ({ documentId }) => {
    registry.releaseQuery(documentId)
    return {}
  })

  // Workers cannot open a panel: an open panel hears the event, a closed one finds the request in
  // storage when it opens. X3
  orca.commands.register('db-studio.openSqliteFile', async () => {
    await orca.storage.set(SQLITE_FORM_REQUEST_KEY, true)
    orca.panels.post('sqlite.formRequested', {})
    return 'Add the SQLite file in the DB Studio panel.'
  })
  orca.commands.register('db-studio.newQuery', async () => {
    const result = await newQuery(orca)
    if (result.status === 'opened') {
      return `Opened ${result.path} in ${result.workspaceName}.`
    }
    await askPanelForWorkspace(orca, result.workspaces)
    return 'Choose the workspace for the new query in the DB Studio panel.'
  })
}

function askPanelForWorkspace(orca: OrcaWorkerApi, workspaces: WorkspaceChoice[]): Promise<void> {
  return orca.storage.set(WORKSPACE_QUESTION_KEY, {
    action: { kind: 'new-query' },
    workspaces: workspaces.map(({ id, name }) => ({ id, name })),
  } satisfies NewQueryQuestion)
}

export async function deactivate(): Promise<void> {
  await connections?.closeAll()
  connections = undefined
}
