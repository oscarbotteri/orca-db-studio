// Panel state and the worker requests that change it.
import { atom, derived, plugin, read, set, update } from 'orca'
import {
  CHOOSER_REQUEST_KEY,
  type ConnectionEntry,
  type ConnectionList,
  type FoundSqliteFile,
  type SchemaTree,
  type WorkspaceChoice,
} from '../protocol'

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'loaded'; value: T }
  | { status: 'error'; error: string }

export const connections = atom<Loadable<ConnectionList>>({ status: 'loading' })

/** Objects of each connection the person expanded, by connection ref. */
export const objects = atom<Record<string, Loadable<SchemaTree>>>({})

export const expanded = atom<string[]>('explorer-expanded', [], { persist: 'plugin' })

/** Set by the "Open SQLite File" command through storage. */
const chooserRequested = atom<boolean>(CHOOSER_REQUEST_KEY, false, { persist: 'storage' })
const chooserPressed = atom(false)
export const chooserOpen = derived(() => read(chooserPressed) || read(chooserRequested))

export const foundFiles = atom<Loadable<FoundSqliteFile[]>>({ status: 'loading' })
export const addError = atom<string | null>(null)
export const adding = atom(false)

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
  for (const { ref } of [...list.value.sqliteFiles, ...list.value.servers]) {
    if (open.has(connectionKey(ref)) && !read(objects)[ref]) void loadObjects(ref)
  }
}

/** Drops what the explorer loaded for a connection that was edited or deleted. */
export function forgetObjects(ref: string): void {
  update(objects, ({ [ref]: _gone, ...rest }) => rest)
}

/** The SQLite file the person is deciding to remove, and why the last attempt failed. */
export interface Removal {
  entry: ConnectionEntry
  error: string | null
}

/** Kept by Orca for the panel, so the card survives a tab switch. */
export const removal = atom<Removal | null>('sqlite-removal', null, { persist: 'plugin' })

export function askToRemove(ref: string): void {
  const list = read(connections)
  const entry = list.status === 'loaded' && list.value.sqliteFiles.find((e) => e.ref === ref)
  if (entry) set(removal, { entry, error: null })
}

export function cancelRemoval(): void {
  set(removal, null)
}

/** Collapses a connection's tree: its own key and every schema key beneath it. */
function collapse(ref: string): void {
  update(expanded, (keys) => keys.filter((key) => parseKey(key)?.[1] !== ref))
}

let removingNow = false

export async function removeSqliteFile(path: string): Promise<void> {
  // A double press must not send two requests.
  if (removingNow) return
  removingNow = true
  try {
    await plugin.request('sqlite.remove', { path })
    collapse(path)
    forgetObjects(path)
    set(removal, null)
  } catch (error) {
    update(removal, (r) => r && { ...r, error: errorMessage(error) })
    return
  } finally {
    removingNow = false
  }
  await refreshConnections()
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

export function openChooser(): void {
  set(chooserPressed, true)
  void loadFoundFiles()
}

export function closeChooser(): void {
  set(chooserPressed, false)
  set(chooserRequested, false)
  set(addError, null)
}

export async function addSqliteFile(path: string): Promise<void> {
  if (!path.trim()) {
    set(addError, 'Enter an absolute path to a SQLite file')
    return
  }
  set(adding, true)
  set(addError, null)
  try {
    await plugin.request('sqlite.add', { path })
    closeChooser()
    await refreshConnections()
  } catch (error) {
    set(addError, errorMessage(error))
  } finally {
    set(adding, false)
  }
}

export interface TableRef {
  ref: string
  schema: string
  table: string
}

/** A table waiting for the person to say which workspace gets its query document. */
export interface WorkspaceQuestion {
  table: TableRef
  workspaces: WorkspaceChoice[]
}

export const workspaceQuestion = atom<WorkspaceQuestion | null>(null)
export const openError = atom<string | null>(null)

let opening = false

export async function openTable(table: TableRef, workspaceId?: string): Promise<void> {
  // A double press must not write two documents.
  if (opening) return
  opening = true
  set(openError, null)
  try {
    const result = await plugin.request('table.open', {
      ...table,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    })
    set(
      workspaceQuestion,
      result.status === 'opened' ? null : { table, workspaces: result.workspaces },
    )
  } catch (error) {
    set(workspaceQuestion, null)
    set(openError, errorMessage(error))
  } finally {
    opening = false
  }
}

export function cancelWorkspaceQuestion(): void {
  set(workspaceQuestion, null)
}
