// Creates query documents in .db-studio/ and opens them with editor.open. E1, ADR 0003
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { OpenTableResult } from '../protocol'
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
    (w) => w.name === context.displayName && w.branch === context.branch,
  )
  return matches.length === 1 ? matches[0] : undefined
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
  const name = await writeDocument(
    dir,
    fileStem(input.table),
    `-- db-studio: connection=${input.ref}\nSELECT * FROM ${schema}.${table} LIMIT ${TABLE_QUERY_LIMIT}\n`,
  )
  const path = `${FOLDER}/${name}`
  await orca.host.call('editor.open', { workspaceId: target.id, path })
  return { status: 'opened', path }
}
