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

/**
 * The workspace Orca is showing, when the context names exactly one of them: the panel needs it to
 * say which connection's documents land where the person is looking.
 */
export async function focusedWorkspace(
  orca: OrcaWorkerApi,
  workspaces: LocalWorkspace[],
): Promise<LocalWorkspace | undefined> {
  const context = await orca.host.call('workspace.readContext')
  if (!context) return undefined
  const matches = workspaces.filter(
    (w) => w.name === context.displayName && w.branch === context.branch,
  )
  return matches.length === 1 ? matches[0] : undefined
}
