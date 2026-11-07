import type { OrcaWorkerApi } from 'orca/worker'
import { CHOOSER_REQUEST_KEY } from '../protocol'
import { type Connections, createConnections } from './connections'
import { findSqliteFiles } from './sqlite-discovery'

let connections: Connections | undefined

export default function activate(orca: OrcaWorkerApi): void {
  const registry = createConnections(orca)
  connections = registry
  orca.panels.handle('connections.list', () => registry.list())
  orca.panels.handle('sqlite.findFiles', async () => ({ files: await findSqliteFiles(orca) }))
  orca.panels.handle('sqlite.add', ({ path }) => registry.addSqliteFile(path.trim()))
  orca.panels.handle('explorer.listObjects', ({ ref }) => registry.listObjects(ref))

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
