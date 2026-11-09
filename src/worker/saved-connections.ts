// Saved connections: the registry in storage:own, each server password in secrets:own. C1, C3
import { basename, dirname, isAbsolute, normalize } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionConfig } from '../drivers'
import type { ConnectionEntry, ConnectionForm, SavedConnection, ServerForm } from '../protocol'

/** Named before SQLite files joined the registry; renaming it would lose every saved connection. */
const SAVED_KEY = 'server-connections'
/** Where v0.2.0 kept SQLite files, as bare paths. Read once and folded into the registry. */
const LEGACY_SQLITE_KEY = 'sqlite-files'

/** Type aliases, not interfaces, so storage accepts them as JSON. */
type StoredServer = {
  id: string
  name: string
  engine: ServerForm['engine']
  host: string
  port: number
  database: string
  user: string
}
type StoredSqlite = { id: string; name: string; engine: 'sqlite'; path: string }
type StoredConnection = StoredServer | StoredSqlite

function isStored(value: unknown): value is StoredConnection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    ('host' in value || 'path' in value)
  )
}

/** A v0.2.0 SQLite file keeps its path as its id, so the documents naming it still work. */
function legacySqlite(path: string): StoredSqlite {
  return { id: path, name: basename(path), engine: 'sqlite', path }
}

async function stored(orca: OrcaWorkerApi): Promise<StoredConnection[]> {
  const value = await orca.storage.get(SAVED_KEY)
  const saved = Array.isArray(value) ? value.filter(isStored) : []
  const legacy = await orca.storage.get(LEGACY_SQLITE_KEY)
  if (!Array.isArray(legacy)) return saved
  const known = new Set(saved.map((c) => c.id))
  const paths = legacy.filter((p): p is string => typeof p === 'string' && !known.has(p))
  const merged = [...saved, ...paths.map(legacySqlite)]
  // The registry is written first: a failure in between leaves both, and the next read merges again.
  await orca.storage.set(SAVED_KEY, merged)
  await orca.storage.delete(LEGACY_SQLITE_KEY)
  return merged
}

function passwordKey(id: string): string {
  return `password:${id}`
}

function entryOf(connection: StoredConnection): ConnectionEntry {
  const { id: ref, name } = connection
  if (connection.engine === 'sqlite') {
    // The folder, not the whole path: a narrow panel would cut the file name off.
    return { ref, name, detail: basename(dirname(connection.path)), origin: 'saved' }
  }
  const { user, host, port, database } = connection
  return { ref, name, detail: `${user}@${host}:${port}/${database}`, origin: 'saved' }
}

function formOf({ id: _id, ...form }: StoredConnection): ConnectionForm {
  return form
}

/**
 * The form with its values trimmed and checked; a SQLite path is made absolute and normal, and
 * names the connection when the person left the name empty.
 */
function cleanForm(form: ConnectionForm): ConnectionForm {
  const name = form.name.trim()
  if (form.engine === 'sqlite') {
    const path = form.path.trim()
    if (!isAbsolute(path)) throw new Error('Enter an absolute path to a SQLite file')
    return { name: name || basename(path), engine: 'sqlite', path: normalize(path) }
  }
  if (!name) throw new Error('Enter a name for the connection')
  const host = form.host.trim()
  if (!host) throw new Error('Enter a host')
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    throw new Error('Enter a port between 1 and 65535')
  }
  return { ...form, name, host, database: form.database.trim(), user: form.user.trim() }
}

function configOfClean(form: ConnectionForm): ConnectionConfig {
  if (form.engine === 'sqlite') return { engine: 'sqlite', path: form.path }
  const { engine, host, port, database, user } = form
  return { engine, host, port, database, user }
}

export function configOf(form: ConnectionForm): ConnectionConfig {
  return configOfClean(cleanForm(form))
}

export async function listSaved(orca: OrcaWorkerApi): Promise<ConnectionEntry[]> {
  return (await stored(orca))
    .map(entryOf)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function findSaved(
  orca: OrcaWorkerApi,
  ref: string,
): Promise<ConnectionConfig | undefined> {
  const found = (await stored(orca)).find((c) => c.id === ref)
  return found && configOf(formOf(found))
}

export async function getSaved(orca: OrcaWorkerApi, ref: string): Promise<SavedConnection> {
  const found = (await stored(orca)).find((c) => c.id === ref)
  if (!found) throw new Error(`No connection ${ref}`)
  return { form: formOf(found), hasPassword: (await orca.secrets.get(passwordKey(ref))) !== null }
}

export async function passwordOf(orca: OrcaWorkerApi, ref: string): Promise<string | undefined> {
  return (await orca.secrets.get(passwordKey(ref))) ?? undefined
}

async function requireSecretsStore(orca: OrcaWorkerApi): Promise<void> {
  const { status } = await orca.host.call('secrets.protection', {})
  if (status === 'unavailable') {
    throw new Error(
      "Orca's secrets store is unavailable on this system, so a password cannot be saved. Save the connection without a password.",
    )
  }
}

/** Two saved connections on one SQLite file would be two names for the same database. */
function refuseDuplicateFile(all: StoredConnection[], form: ConnectionForm, id: string): void {
  if (form.engine !== 'sqlite') return
  const other = all.find((c) => c.id !== id && c.engine === 'sqlite' && c.path === form.path)
  if (other) throw new Error(`This file is already saved as ${other.name}`)
}

/**
 * Saves the form; the password goes to secrets first, so a refusal leaves nothing behind.
 * `check` runs on the cleaned form before anything is written.
 */
export async function saveConnection(
  orca: OrcaWorkerApi,
  input: { ref?: string; form: ConnectionForm; password?: string },
  check: (config: ConnectionConfig) => Promise<void> = async () => undefined,
): Promise<ConnectionEntry> {
  const form = cleanForm(input.form)
  const all = await stored(orca)
  if (input.ref && !all.some((c) => c.id === input.ref))
    throw new Error(`No connection ${input.ref}`)
  const id = input.ref ?? crypto.randomUUID()
  refuseDuplicateFile(all, form, id)
  await check(configOfClean(form))
  // A SQLite file has no password to keep.
  const password = form.engine === 'sqlite' ? undefined : input.password
  if (password) {
    await requireSecretsStore(orca)
    await orca.secrets.set(passwordKey(id), password)
  }
  const next: StoredConnection = { id, ...form }
  try {
    await orca.storage.set(
      SAVED_KEY,
      input.ref ? all.map((c) => (c.id === id ? next : c)) : [...all, next],
    )
  } catch (error) {
    // A new connection must not leave a password nothing points to.
    if (password && !input.ref) await orca.secrets.delete(passwordKey(id)).catch(() => undefined)
    throw error
  }
  // A server turned into a SQLite file must not keep a password nothing uses.
  if (form.engine === 'sqlite' && input.ref) {
    await orca.secrets.delete(passwordKey(id)).catch(() => undefined)
  }
  orca.panels.post('connections.changed', {})
  return entryOf(next)
}

export async function deleteSaved(orca: OrcaWorkerApi, ref: string): Promise<void> {
  const all = await stored(orca)
  if (!all.some((c) => c.id === ref)) throw new Error(`No connection ${ref}`)
  await orca.storage.set(
    SAVED_KEY,
    all.filter((c) => c.id !== ref),
  )
  // The entry is already gone; a secrets store that refuses to delete must not hide that.
  await orca.secrets.delete(passwordKey(ref)).catch(() => undefined)
  orca.panels.post('connections.changed', {})
}
