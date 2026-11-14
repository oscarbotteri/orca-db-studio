// The hosted providers' tabs: their keys, the projects those keys reach, and which tab is open.
import { atom, plugin, read, set } from 'orca'
import type { CloudBranch, Provider, ProviderView } from '../protocol'
import type { Loadable } from './state'

/** Which tab of the panel is open; `workspaces` is the connections Orca already knows. */
export type PanelTab = Provider | 'workspaces'

export const activeTab = atom<PanelTab>('panel-tab', 'workspaces', { persist: 'plugin' })

/** What the person has typed in each provider's token field, and nothing else. */
export const providerInput = atom<Record<Provider, string>>({ neon: '', supabase: '' })

export const providerViews = atom<Record<Provider, Loadable<ProviderView>>>({
  neon: { status: 'loading' },
  supabase: { status: 'loading' },
})

export const providerBusy = atom<Provider | null>(null)

/** The account each provider's selector is on; the worker's answer settles it. */
export const providerAccount = atom<Record<Provider, string | undefined>>({
  neon: undefined,
  supabase: undefined,
})

function setView(provider: Provider, view: Loadable<ProviderView>): void {
  set(providerViews, { ...read(providerViews), [provider]: view })
}

export function openTab(tab: PanelTab): void {
  set(activeTab, tab)
  if (tab !== 'workspaces') void loadProvider(tab)
}

export function typeProviderInput(provider: Provider, value: string): void {
  set(providerInput, { ...read(providerInput), [provider]: value })
}

async function run(provider: Provider, request: () => Promise<ProviderView>): Promise<void> {
  if (read(providerBusy)) return
  set(providerBusy, provider)
  try {
    const value = await request()
    if (value.selected)
      set(providerAccount, { ...read(providerAccount), [provider]: value.selected })
    setView(provider, { status: 'loaded', value })
  } catch (error) {
    setView(provider, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    set(providerBusy, null)
  }
}

/** Reads the keys and the projects again; a provider without keys answers with no projects. */
/** Reads the projects of the account the selector is on (the first one when it is unset). */
export function loadProvider(provider: Provider, keyId?: string): Promise<void> {
  return run(provider, () =>
    plugin.request('provider.view', { provider, ...(keyId ? { keyId } : {}) }),
  )
}

/** Switches the selector to another stored account and lists what it reaches. */
export function selectAccount(provider: Provider, keyId: string): Promise<void> {
  set(providerAccount, { ...read(providerAccount), [provider]: keyId })
  return loadProvider(provider, keyId)
}

/** Stores the token or the path that holds it, then lists what it reaches. */
export function addProviderKey(provider: Provider): Promise<void> {
  const value = read(providerInput)[provider].trim()
  if (!value) {
    setView(provider, {
      status: 'error',
      error: 'Paste a token, or the path of a file that holds it',
    })
    return Promise.resolve()
  }
  return run(provider, async () => {
    const view = await plugin.request('provider.addKey', { provider, value })
    typeProviderInput(provider, '')
    return view
  })
}

/** Forgets the account the selector is on, or every one when there is none. */
export function clearProviderKeys(provider: Provider): Promise<void> {
  const keyId = read(providerAccount)[provider]
  return run(provider, () =>
    plugin.request('provider.clearKeys', { provider, ...(keyId ? { keyId } : {}) }),
  )
}

/** The branches, with their databases, of each project read: `${provider}:${projectId}`. */
export const providerDatabases = atom<Record<string, Loadable<CloudBranch[]>>>({})

/** What was just opened, so the tab can say where the new connection went. */
export const providerNotice = atom<string | null>(null)
export const connectBusy = atom<string | null>(null)

function databaseKey(provider: Provider, projectId: string): string {
  return `${provider}:${projectId}`
}

export async function loadDatabases(provider: Provider, projectId: string): Promise<void> {
  const key = databaseKey(provider, projectId)
  set(providerDatabases, { ...read(providerDatabases), [key]: { status: 'loading' } })
  try {
    const keyId = read(providerAccount)[provider]
    const { branches } = await plugin.request('provider.databases', {
      provider,
      projectId,
      ...(keyId ? { keyId } : {}),
    })
    set(providerDatabases, {
      ...read(providerDatabases),
      [key]: { status: 'loaded', value: branches },
    })
  } catch (error) {
    set(providerDatabases, {
      ...read(providerDatabases),
      [key]: { status: 'error', error: error instanceof Error ? error.message : String(error) },
    })
  }
}

/** Opens a database as a connection; the worker posts `connections.changed` so the list reloads. */
export async function openDatabase(
  provider: Provider,
  projectId: string,
  database: string,
  branchId?: string,
): Promise<void> {
  const key = databaseKey(provider, projectId)
  if (read(connectBusy)) return
  set(connectBusy, key)
  set(providerNotice, null)
  try {
    const keyId = read(providerAccount)[provider]
    const entry = await plugin.request('provider.connect', {
      provider,
      projectId,
      database,
      ...(branchId ? { branchId } : {}),
      ...(keyId ? { keyId } : {}),
    })
    set(providerNotice, `${entry.name} is in Orca Workspaces, under Cloud databases.`)
  } catch (error) {
    set(providerNotice, error instanceof Error ? error.message : String(error))
  } finally {
    set(connectBusy, null)
  }
}
