// Panel state and the worker requests that change it.
import { atom, derived, plugin, read, set, update } from 'orca'
import {
  type ConnectionList,
  type FoundSqliteFile,
  NEW_QUERY_REQUEST_KEY,
  type OpenDocumentResult,
  type SchemaTree,
  type WorkspaceChoice,
} from '../protocol'
import { assertNever } from '../utils/assert-never'

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'loaded'; value: T }
  | { status: 'error'; error: string }

export const connections = atom<Loadable<ConnectionList>>({ status: 'loading' })

/** Objects of each connection the person expanded, by connection ref. */
export const objects = atom<Record<string, Loadable<SchemaTree>>>({})

export const expanded = atom<string[]>('explorer-expanded', [], { persist: 'plugin' })

export const foundFiles = atom<Loadable<FoundSqliteFile[]>>({ status: 'loading' })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Tree keys are unique across levels and safe for any name or path. */
export function treeKey(...parts: string[]): string {
  return JSON.stringify(parts)
}

/** The parts a tree key was made of, or undefined when it is not one of ours. */
export function parseKey(key: string): unknown[] | undefined {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) ? parts : undefined
  } catch {
    return undefined
  }
}

export function connectionKey(ref: string): string {
  return treeKey('connection', ref)
}

export function schemaKey(ref: string, schema: string): string {
  return treeKey('schema', ref, schema)
}

async function load<T>(request: () => Promise<T>): Promise<Loadable<T>> {
  try {
    return { status: 'loaded', value: await request() }
  } catch (error) {
    return { status: 'error', error: errorMessage(error) }
  }
}

export async function refreshConnections(): Promise<void> {
  set(connections, await load(() => plugin.request('connections.list')))
}

export async function loadObjects(ref: string): Promise<void> {
  const loading: Loadable<SchemaTree> = { status: 'loading' }
  update(objects, (all) => ({ ...all, [ref]: loading }))
  const state = await load(() => plugin.request('explorer.listObjects', { ref }))
  update(objects, (all) => ({ ...all, [ref]: state }))
}

/** Loads the objects of every expanded connection that has none yet. */
export function loadExpandedObjects(): void {
  const list = read(connections)
  if (list.status !== 'loaded') return
  const open = new Set(read(expanded))
  for (const { ref } of [...list.value.saved, ...list.value.worktrees]) {
    if (open.has(connectionKey(ref)) && !read(objects)[ref]) void loadObjects(ref)
  }
}

/** Drops what the explorer loaded for a connection that was edited or deleted. */
export function forgetObjects(ref: string): void {
  update(objects, ({ [ref]: _gone, ...rest }) => rest)
}

/** Collapses a connection's tree: its own key and every schema key beneath it. */
export function collapse(ref: string): void {
  update(expanded, (keys) => keys.filter((key) => parseKey(key)?.[1] !== ref))
}

export function toggle(key: string, isExpanded: boolean): void {
  update(expanded, (keys) =>
    isExpanded ? [...new Set([...keys, key])] : keys.filter((k) => k !== key),
  )
  if (isExpanded) loadExpandedObjects()
}

export async function loadFoundFiles(): Promise<void> {
  set(foundFiles, { status: 'loading' })
  set(foundFiles, await load(async () => (await plugin.request('sqlite.findFiles')).files))
}

export interface TableRef {
  ref: string
  schema: string
  table: string
}

/** What waits for the person to say which workspace gets its query document. */
export type WorkspaceAction = { kind: 'table'; table: TableRef } | { kind: 'new-query' }

export interface WorkspaceQuestion {
  action: WorkspaceAction
  workspaces: WorkspaceChoice[]
}

/** Why a query document could not be opened, under a title naming what was asked. */
export interface OpenError {
  title: string
  text: string
}

const tableQuestion = atom<WorkspaceQuestion | null>(null)
/** Set by the "New Query" command through storage, so a closed panel still asks once it opens. */
const newQueryRequest = atom<WorkspaceChoice[] | null>(NEW_QUERY_REQUEST_KEY, null, {
  persist: 'storage',
})

export const workspaceQuestion = derived<WorkspaceQuestion | null>(() => {
  const workspaces = read(newQueryRequest)
  return workspaces ? { action: { kind: 'new-query' }, workspaces } : read(tableQuestion)
})
export const openError = atom<OpenError | null>(null)

let opening = false

/** Runs one request that opens a query document; a double press must not write two. */
async function openDocument(
  title: string,
  request: () => Promise<OpenDocumentResult>,
  onChoose: (workspaces: WorkspaceChoice[]) => void,
): Promise<void> {
  if (opening) return
  opening = true
  set(openError, null)
  try {
    const result = await request()
    cancelWorkspaceQuestion()
    if (result.status === 'choose-workspace') onChoose(result.workspaces)
  } catch (error) {
    cancelWorkspaceQuestion()
    set(openError, { title, text: errorMessage(error) })
  } finally {
    opening = false
  }
}

export function openTable(table: TableRef, workspaceId?: string): Promise<void> {
  return openDocument(
    'Could not open the table',
    () =>
      plugin.request('table.open', {
        ...table,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }),
    (workspaces) => set(tableQuestion, { action: { kind: 'table', table }, workspaces }),
  )
}

function newQuery(workspaceId: string): Promise<void> {
  return openDocument(
    'Could not create the query',
    () => plugin.request('query.new', { workspaceId }),
    (workspaces) => set(newQueryRequest, workspaces),
  )
}

export function answerWorkspaceQuestion(question: WorkspaceQuestion, workspaceId: string): void {
  const { action } = question
  switch (action.kind) {
    case 'table':
      void openTable(action.table, workspaceId)
      break
    case 'new-query':
      void newQuery(workspaceId)
      break
    default:
      assertNever(action)
  }
}

export function cancelWorkspaceQuestion(): void {
  set(tableQuestion, null)
  set(newQueryRequest, null)
}
