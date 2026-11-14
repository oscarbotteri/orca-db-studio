import { type PanelContext, plugin, Stack } from 'orca'
import { ConnectionForm } from './connection-form'
import { openSqliteForm, sqliteFormWasRequested } from './connection-form-state'
import { Connections } from './connections'
import { loadProvider } from './provider-state'
import { loadExpandedObjects, refreshConnections } from './state'

async function refresh(): Promise<void> {
  await refreshConnections()
  loadExpandedObjects()
}

export function setup(ctx: PanelContext): void {
  void refresh()
  // The provider tabs show their stored keys without being opened, so both are read once.
  void loadProvider('neon')
  void loadProvider('supabase')
  if (sqliteFormWasRequested()) openSqliteForm()
  ctx.subscriptions.push(
    plugin.on('connections.changed', () => void refresh()),
    plugin.on('sqlite.formRequested', openSqliteForm),
  )
}

export default function Panel() {
  return (
    <Stack gap="md">
      <ConnectionForm />
      <Connections />
    </Stack>
  )
}
