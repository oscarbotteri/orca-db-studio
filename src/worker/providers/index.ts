// One place for both hosted providers: their accounts, and the projects those accounts reach.
import type { OrcaWorkerApi } from 'orca/worker'
import type {
  CloudBranch,
  CloudProject,
  ConnectionEntry,
  Provider,
  ProviderView,
} from '../../protocol'
import { addCloud } from '../cloud-connections'
import { addKey, clearKeys, listKeys, tokensOf } from './keys'
import {
  connectionUri,
  listBranches,
  listProjects as listNeon,
  accountLabel as neonLabel,
} from './neon'
import { listProjects as listSupabase, accountLabel as supabaseLabel } from './supabase'

const LISTERS: Record<Provider, (keys: string[]) => Promise<CloudProject[]>> = {
  neon: listNeon,
  supabase: listSupabase,
}

const LABELS: Record<Provider, (token: string) => Promise<string>> = {
  neon: neonLabel,
  supabase: supabaseLabel,
}

/** The account whose projects are listed: the one the panel picked, else the first stored. */
async function tokenFor(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<{ token: string; selected: string } | undefined> {
  const keys = await listKeys(orca, provider)
  const wanted = keyId ? keys.find((key) => key.id === keyId) : keys[0]
  if (!wanted) return undefined
  const [token] = await tokensOf(orca, provider, wanted.id)
  return token ? { token, selected: wanted.id } : undefined
}

async function view(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  const keys = await listKeys(orca, provider)
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) return { keys, projects: [] }
  try {
    return { keys, selected: chosen.selected, projects: await LISTERS[provider]([chosen.token]) }
  } catch (error) {
    // A refused key must not hide the accounts already stored: it has to be replaceable.
    return {
      keys,
      selected: chosen.selected,
      projects: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function providerView(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  return view(orca, provider, keyId)
}

/** Adds an account and shows its projects, so the selector lands on the one just added. */
export async function addProviderKey(
  orca: OrcaWorkerApi,
  provider: Provider,
  value: string,
): Promise<ProviderView> {
  await addKey(orca, provider, value, LABELS[provider])
  const keys = await listKeys(orca, provider)
  return view(orca, provider, keys[keys.length - 1]?.id)
}

export async function clearProviderKeys(
  orca: OrcaWorkerApi,
  provider: Provider,
  keyId?: string,
): Promise<ProviderView> {
  await clearKeys(orca, provider, keyId)
  return view(orca, provider)
}

/** The branches of one project with their databases, read when the person asks for them. */
export async function databasesOf(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
  keyId?: string,
): Promise<CloudBranch[]> {
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) throw new Error('Save a token for this provider first')
  if (provider !== 'neon') {
    throw new Error('Supabase still needs the database password: it comes in the next step')
  }
  return listBranches([chosen.token], projectId)
}

/** Opens a provider's database as a connection: the API hands over the full string. */
export async function connectCloud(
  orca: OrcaWorkerApi,
  provider: Provider,
  projectId: string,
  databaseName: string,
  branchId?: string,
  keyId?: string,
): Promise<ConnectionEntry> {
  if (provider !== 'neon') {
    throw new Error('Supabase still needs the database password: it comes in the next step')
  }
  const chosen = await tokenFor(orca, provider, keyId)
  if (!chosen) throw new Error('Save a token for this provider first')
  const tokens = [chosen.token]
  const branches = await listBranches(tokens, projectId)
  const branch = branchId
    ? branches.find((candidate) => candidate.id === branchId)
    : (branches.find((candidate) => candidate.isDefault) ?? branches[0])
  const database = branch?.databases.find((candidate) => candidate.name === databaseName)
  if (!branch || !database) throw new Error(`${databaseName} is no longer in that project`)
  const uri = await connectionUri(tokens, projectId, database, branch.id)
  const projectName = (await listNeon(tokens)).find((p) => p.id === projectId)?.name ?? projectId
  const parsed = new URL(uri.replace(/^postgres(ql)?:\/\//, 'http://'))
  // Two branches hold a database of the same name, so the branch is part of what names it.
  const suffix = branches.length > 1 ? ` (${branch.name})` : ''
  return addCloud(
    orca,
    {
      provider,
      projectId,
      database: database.name,
      branchId: branch.id,
      name: `${projectName} · ${database.name}${suffix}`,
      detail: `${parsed.host}${parsed.pathname}`,
    },
    uri,
  )
}
