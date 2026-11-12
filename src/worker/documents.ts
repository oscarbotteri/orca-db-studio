// Creates query documents in .db-studio/ and opens them with editor.open. E1, X1, ADR 0003
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { OpenDocumentResult } from '../protocol'
import type { Connections } from './connections'
import { type LocalWorkspace, listLocalWorkspaces } from './local-workspaces'
import { parseWorktreeRef } from './worktree-connections'

const FOLDER = '.db-studio'
/** The table query is a starting point; the person edits it. */
const TABLE_QUERY_LIMIT = 100

export interface OpenTableInput {
  ref: string
  schema: string
  table: string
  workspaceId?: string
}

/** The focused workspace when it matches exactly one workspace of the list. */
async function focusedWorkspace(
  orca: OrcaWorkerApi,
  workspaces: LocalWorkspace[],
): Promise<LocalWorkspace | undefined> {
  const context = await orca.host.call('workspace.readContext')
  if (!context) return undefined
  const matches = workspaces.filter(
    (workspace) => workspace.name === context.displayName && workspace.branch === context.branch,
  )
  return matches.length === 1 ? matches[0] : undefined
}

async function targetWorkspace(
  orca: OrcaWorkerApi,
  workspaces: LocalWorkspace[],
  workspaceId: string | undefined,
): Promise<LocalWorkspace | undefined> {
  if (workspaceId !== undefined) {
    const chosen = workspaces.find((workspace) => workspace.id === workspaceId)
    if (!chosen) throw new Error('That workspace is no longer open')
    return chosen
  }
  const focused = await focusedWorkspace(orca, workspaces)
  if (focused) return focused
  return workspaces.length === 1 ? workspaces[0] : undefined
}

async function requireLocalWorkspaces(orca: OrcaWorkerApi): Promise<LocalWorkspace[]> {
  const workspaces = await listLocalWorkspaces(orca)
  if (workspaces.length === 0) {
    throw new Error(
      'DB Studio needs a local workspace. Open a folder or worktree on this machine, then try again.',
    )
  }
  return workspaces
}

function fileStem(table: string): string {
  return table.replace(/[^\w.-]+/g, '_') || 'table'
}

/** Writes the document under the first free name: `orders.sql`, `orders-2.sql`, ... */
async function writeDocument(dir: string, stem: string, content: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}.sql` : `${stem}-${n}.sql`
    try {
      await writeFile(join(dir, name), content, { flag: 'wx' })
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

async function ensureQueryFolder(workspace: LocalWorkspace): Promise<string> {
  const dir = join(workspace.path, FOLDER)
  await mkdir(dir, { recursive: true })
  // The folder ignores itself, so the repo's own .gitignore is never touched.
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  return dir
}

async function openDocument(
  orca: OrcaWorkerApi,
  workspaceId: string | undefined,
  stem: string,
  content: string,
): Promise<OpenDocumentResult> {
  const workspaces = await requireLocalWorkspaces(orca)
  const target = await targetWorkspace(orca, workspaces, workspaceId)
  if (!target) {
    return {
      status: 'choose-workspace',
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        branch: workspace.branch,
      })),
    }
  }

  const name = await writeDocument(await ensureQueryFolder(target), stem, content)
  const path = `${FOLDER}/${name}`
  await orca.host.call('editor.open', { workspaceId: target.id, path })
  return { status: 'opened', path, workspaceName: target.name }
}

export async function openTable(
  orca: OrcaWorkerApi,
  connections: Connections,
  input: OpenTableInput,
): Promise<OpenDocumentResult> {
  const schema = await connections.quoteIdent(input.ref, input.schema)
  const table = await connections.quoteIdent(input.ref, input.table)
  // A worktree connection's document belongs in the worktree the connection was read from.
  const workspaceId = input.workspaceId ?? parseWorktreeRef(input.ref)?.workspaceId
  return openDocument(
    orca,
    workspaceId,
    fileStem(input.table),
    `-- db-studio: connection=${input.ref}\nSELECT * FROM ${schema}.${table} LIMIT ${TABLE_QUERY_LIMIT}\n`,
  )
}

/** An empty query document; the editor then asks for its connection. X1 */
export function newQuery(orca: OrcaWorkerApi, workspaceId?: string): Promise<OpenDocumentResult> {
  return openDocument(orca, workspaceId, 'query', '')
}
