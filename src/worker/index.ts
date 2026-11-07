import type { OrcaWorkerApi } from 'orca/worker'
import { CHOOSER_REQUEST_KEY } from '../protocol'
import { type Connections, createConnections } from './connections'
import { openTable } from './documents'
import { findSqliteFiles } from './sqlite-discovery'

const DEFAULT_ROW_LIMIT = 100
/** A worker answer is at most 1 MiB, so no setting can ask for more rows than this. */
const RESULT_CEILING_ROWS = 5000

let connections: Connections | undefined

export default function activate(orca: OrcaWorkerApi): void {
  const registry = createConnections(orca)
  connections = registry
  orca.panels.handle('connections.list', () => registry.list())
  orca.panels.handle('sqlite.findFiles', async () => ({ files: await findSqliteFiles(orca) }))
  orca.panels.handle('sqlite.add', ({ path }) => registry.addSqliteFile(path.trim()))
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
  orca.panels.handle('query.run', async ({ ref, sql }) => {
    const limit = await orca.settings.get('rowLimit')
    const rowLimit =
      typeof limit === 'number' && limit >= 1
        ? Math.min(limit, RESULT_CEILING_ROWS)
        : DEFAULT_ROW_LIMIT
    return registry.runQuery(ref, sql, rowLimit)
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
