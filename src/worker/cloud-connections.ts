// Cloud connections: a hosted provider's database, opened as a connection the explorer can use.
// The registry (names and refs) lives in storage:own; the connection string, password included,
// lives in secrets:own.
import type { OrcaWorkerApi } from 'orca/worker'
import { parseConnectionString } from '../connection-string'
import type { ConnectionConfig } from '../drivers'
import type { ConnectionEntry, Provider } from '../protocol'

const REGISTRY_KEY = 'cloud-connections'
const REF_PREFIX = 'cloud:'

/**
 * What the registry keeps of each opened database, never the connection string. A type alias, not
 * an interface, so storage accepts it as JSON.
 */
export type CloudRecord = {
  provider: Provider
  /** The provider's own id for the project (Neon, Supabase). */
  projectId: string
  database: string
  /** The branch the database lives on, when the provider has them. */
  branchId?: string
  name: string
  detail: string
}

function refOf(
  record: Pick<CloudRecord, 'provider' | 'projectId' | 'database'> & { branchId?: string },
): string {
  const branch = record.branchId ? `${encodeURIComponent(record.branchId)}:` : ''
  return `${REF_PREFIX}${record.provider}:${encodeURIComponent(record.projectId)}:${branch}${encodeURIComponent(record.database)}`
}

function secretKey(ref: string): string {
  return `cloud-uri:${ref}`
}

export function isCloudRef(ref: string): boolean {
  return ref.startsWith(REF_PREFIX)
}

async function readRegistry(orca: OrcaWorkerApi): Promise<CloudRecord[]> {
  const value = await orca.storage.get(REGISTRY_KEY)
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is CloudRecord =>
      typeof item === 'object' && item !== null && 'database' in item && 'provider' in item,
  )
}

function entryOf(record: CloudRecord): ConnectionEntry {
  return {
    ref: refOf(record),
    name: record.name,
    detail: record.detail,
    origin: 'cloud',
  }
}

export async function listCloud(orca: OrcaWorkerApi): Promise<ConnectionEntry[]> {
  return (await readRegistry(orca)).map(entryOf)
}

/** Stores the connection string in secrets first, so a failure leaves no half connection behind. */
export async function addCloud(
  orca: OrcaWorkerApi,
  record: CloudRecord,
  uri: string,
): Promise<ConnectionEntry> {
  const ref = refOf(record)
  await orca.secrets.set(secretKey(ref), uri)
  const registry = await readRegistry(orca)
  const others = registry.filter(
    (item) =>
      !(
        item.provider === record.provider &&
        item.projectId === record.projectId &&
        item.database === record.database &&
        item.branchId === record.branchId
      ),
  )
  await orca.storage.set(REGISTRY_KEY, [...others, record])
  return entryOf(record)
}

export async function removeCloud(orca: OrcaWorkerApi, ref: string): Promise<void> {
  const registry = await readRegistry(orca)
  const kept = registry.filter((item) => refOf(item) !== ref)
  if (kept.length === registry.length) return
  await orca.storage.set(REGISTRY_KEY, kept)
  await orca.secrets.delete(secretKey(ref))
}

/** What the ref points at now, and how to open it; rejects when the connection is gone. */
export async function resolveCloud(
  orca: OrcaWorkerApi,
  ref: string,
): Promise<{ config: ConnectionConfig; password: string | undefined; detail: string }> {
  const uri = await orca.secrets.get(secretKey(ref))
  if (!uri) throw new Error('That cloud connection is no longer stored')
  const parsed = parseConnectionString(uri)
  if (!parsed) throw new Error('The stored connection string cannot be used')
  const { engine, host, port, database, user, ssl, password } = parsed
  return {
    config: { engine, host, port, database, user, ...(ssl ? { ssl } : {}) },
    password: password || undefined,
    detail: `${user ? `${user}@` : ''}${host}:${port}${database ? `/${database}` : ''}`,
  }
}
