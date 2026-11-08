import { type PanelContext, plugin, read, Stack } from 'orca'
import { ConnectionForm } from './connection-form'
import { ServerConnections, SqliteFiles, WorktreeConnections } from './connections'
import { SqliteChooser } from './sqlite-chooser'
import {
  chooserOpen,
  loadExpandedObjects,
  loadFoundFiles,
  openChooser,
  refreshConnections,
} from './state'

async function refresh(): Promise<void> {
  await refreshConnections()
  loadExpandedObjects()
}

export function setup(ctx: PanelContext): void {
  void refresh()
  if (read(chooserOpen)) void loadFoundFiles()
  ctx.subscriptions.push(
    plugin.on('connections.changed', () => void refresh()),
    plugin.on('sqlite.chooserRequested', openChooser),
  )
}

export default function Panel() {
  return (
    <Stack gap="md">
      <ConnectionForm />
      <ServerConnections />
      <WorktreeConnections />
      {read(chooserOpen) ? <SqliteChooser /> : null}
      <SqliteFiles />
    </Stack>
  )
}
