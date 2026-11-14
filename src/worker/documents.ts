// Creates query documents in .db-studio/ and opens them with editor.open. E1, ADR 0003
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { OpenTableResult } from '../protocol'
import type { Connections } from './connections'
import { focusedWorkspace, type LocalWorkspace, listLocalWorkspaces } from './local-workspaces'
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

async function targetWorkspace(
  orca: OrcaWorkerApi,
  workspaces: LocalWorkspace[],
  workspaceId: string | undefined,
): Promise<LocalWorkspace | undefined> {
  if (workspaceId === undefined) return focusedWorkspace(orca, workspaces)
  const chosen = workspaces.find((w) => w.id === workspaceId)
  if (!chosen) throw new Error('That workspace is no longer open')
  return chosen
}

function fileStem(table: string): string {
  return table.replace(/[^\w.-]+/g, '_') || 'table'
}

/** The two lines that say what a document is for; below them is whatever the person typed. */
function signatureOf(text: string): string {
  return text.split('\n').slice(0, 2).join('\n')
}

/**
 * The document this plugin already wrote for the same connection and table, when there is one:
 * opening a table twice must not fill `.db-studio/` with copies, and the copy that exists may
 * hold edits worth keeping.
 */
async function existingDocument(dir: string, content: string): Promise<string | undefined> {
  const wanted = signatureOf(content)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
  } catch {
    return undefined
  }
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '')
    if (signatureOf(text) === wanted) return name
  }
  return undefined
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

/**
 * Orca opens the tab in its workspace without moving the person there, so a click on a table of
 * another workspace looks like nothing happened. Showing that workspace brings them to the tab.
 */
async function showWorkspace(orca: OrcaWorkerApi, workspaceId: string): Promise<void> {
  if (!orca.host.has('workspace.open')) return
  // The tab is already open: a refusal here must not turn into a failure of the whole request.
  await orca.host.call('workspace.open', { workspaceId }).catch(() => undefined)
}

export async function openTable(
  orca: OrcaWorkerApi,
  connections: Connections,
  input: OpenTableInput,
): Promise<OpenTableResult> {
  const workspaces = await listLocalWorkspaces(orca)
  if (workspaces.length === 0) throw new Error('Open a workspace to open a table')

  const schema = await connections.quoteIdent(input.ref, input.schema)
  const table = await connections.quoteIdent(input.ref, input.table)
  // A worktree connection's document belongs in the worktree the connection was read from.
  const workspaceId = input.workspaceId ?? parseWorktreeRef(input.ref)?.workspaceId
  // Read before showing the workspace: afterwards it is always the focused one.
  const focused = await focusedWorkspace(orca, workspaces)
  const target = await targetWorkspace(orca, workspaces, workspaceId)
  if (!target) {
    return {
      status: 'choose-workspace',
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    }
  }

  const dir = join(target.path, FOLDER)
  await mkdir(dir, { recursive: true })
  // The folder ignores itself, so the repo's own .gitignore is never touched.
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const content = `-- db-studio: connection=${input.ref}\nSELECT * FROM ${schema}.${table} LIMIT ${TABLE_QUERY_LIMIT}\n`
  const name =
    (await existingDocument(dir, content)) ??
    (await writeDocument(dir, fileStem(input.table), content))
  const path = `${FOLDER}/${name}`
  await orca.host.call('editor.open', { workspaceId: target.id, path })
  await showWorkspace(orca, target.id)
  return {
    status: 'opened',
    path,
    workspace: { id: target.id, name: target.name },
    elsewhere: focused !== undefined && focused.id !== target.id,
  }
}
