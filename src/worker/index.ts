import type { OrcaWorkerApi } from 'orca/worker'
import { CHOOSER_REQUEST_KEY } from '../protocol'
import { type Connections, createConnections } from './connections'
import { openTable } from './documents'
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
  orca.panels.handle('sqlite.add', ({ path }) => registry.addSqliteFile(path.trim()))
  orca.panels.handle('sqlite.remove', async ({ path }) => {
    await registry.removeSqliteFile(path)
    return {}
  })
  orca.panels.handle('connection.save', (input) => registry.saveServer(input))
  orca.panels.handle('connection.test', async (input) => {
    await registry.testServer(input)
    return {}
  })
  orca.panels.handle('connection.get', ({ ref }) => registry.getServer(ref))
  orca.panels.handle('connection.delete', async ({ ref }) => {
    await registry.deleteServer(ref)
    return {}
  })
  orca.panels.handle('explorer.listObjects', ({ ref }) => registry.listObjects(ref))
  orca.panels.handle('table.open', (input) => openTable(orca, registry, input))
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
    await orca.storage.set(CHOOSER_REQUEST_KEY, true)
    orca.panels.post('sqlite.chooserRequested', {})
    return 'Choose a SQLite file in the DB Studio panel.'
  })
}

export async function deactivate(): Promise<void> {
  await connections?.closeAll()
  connections = undefined
}
