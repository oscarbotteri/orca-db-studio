import type { OrcaWorkerApi } from 'orca/worker'

export interface LocalWorkspace {
  id: string
  name: string
  path: string
  branch: string | null
}

/**
 * Orca reports the host id of a local workspace as `"local"` (`null` also counts as local);
 * any other id is a remote host, whose paths mean nothing on this machine.
 */
export async function listLocalWorkspaces(orca: OrcaWorkerApi): Promise<LocalWorkspace[]> {
  const { workspaces } = await orca.host.call('workspace.list')
  return workspaces.filter((w) => w.hostId === 'local' || w.hostId === null)
}
