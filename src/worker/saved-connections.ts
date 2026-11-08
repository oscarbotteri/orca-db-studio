// Saved server connections: the registry in storage:own, each password in secrets:own. C1
import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionConfig } from '../drivers/types'
import type { ConnectionEntry, ConnectionForm, SavedConnection, ServerEngine } from '../protocol'

const SERVERS_KEY = 'server-connections'

/** A type alias, not an interface, so storage accepts it as JSON. */
type StoredConnection = {
  id: string
  name: string
  engine: ServerEngine
  host: string
  port: number
  database: string
  user: string
}

function isStored(value: unknown): value is StoredConnection {
  return typeof value === 'object' && value !== null && 'id' in value && 'host' in value
}

async function stored(orca: OrcaWorkerApi): Promise<StoredConnection[]> {
  const value = await orca.storage.get(SERVERS_KEY)
  return Array.isArray(value) ? value.filter(isStored) : []
}

function passwordKey(id: string): string {
  return `password:${id}`
}

function entryOf(connection: StoredConnection): ConnectionEntry {
  const { id, name, user, host, port, database } = connection
  return { ref: id, name, detail: `${user}@${host}:${port}/${database}` }
}

function formOf({ id: _id, ...form }: StoredConnection): ConnectionForm {
  return form
}

export function validateForm(form: ConnectionForm): void {
  if (!form.name.trim()) throw new Error('Enter a name for the connection')
  if (!form.host.trim()) throw new Error('Enter a host')
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    throw new Error('Enter a port between 1 and 65535')
  }
}

export function configOf(form: ConnectionForm): ConnectionConfig {
  validateForm(form)
  return {
    engine: form.engine,
    host: form.host.trim(),
    port: form.port,
    database: form.database.trim(),
    user: form.user.trim(),
  }
}

export async function listServers(orca: OrcaWorkerApi): Promise<ConnectionEntry[]> {
  return (await stored(orca)).map(entryOf)
}

export async function findServer(
  orca: OrcaWorkerApi,
  ref: string,
): Promise<ConnectionConfig | undefined> {
  const found = (await stored(orca)).find((c) => c.id === ref)
  return found && configOf(formOf(found))
}

export async function getServer(orca: OrcaWorkerApi, ref: string): Promise<SavedConnection> {
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

/** Saves the form; the password goes to secrets first, so a refusal leaves nothing behind. */
export async function saveServer(
  orca: OrcaWorkerApi,
  input: { ref?: string; form: ConnectionForm; password?: string },
): Promise<ConnectionEntry> {
  validateForm(input.form)
  const all = await stored(orca)
  if (input.ref && !all.some((c) => c.id === input.ref))
    throw new Error(`No connection ${input.ref}`)
  const id = input.ref ?? crypto.randomUUID()
  if (input.password) {
    await requireSecretsStore(orca)
    await orca.secrets.set(passwordKey(id), input.password)
  }
  const { form } = input
  const next: StoredConnection = {
    id,
    ...form,
    name: form.name.trim(),
    host: form.host.trim(),
    database: form.database.trim(),
    user: form.user.trim(),
  }
  try {
    await orca.storage.set(
      SERVERS_KEY,
      input.ref ? all.map((c) => (c.id === id ? next : c)) : [...all, next],
    )
  } catch (error) {
    // A new connection must not leave a password nothing points to.
    if (input.password && !input.ref)
      await orca.secrets.delete(passwordKey(id)).catch(() => undefined)
    throw error
  }
  orca.panels.post('connections.changed', {})
  return entryOf(next)
}

export async function deleteServer(orca: OrcaWorkerApi, ref: string): Promise<void> {
  const all = await stored(orca)
  if (!all.some((c) => c.id === ref)) throw new Error(`No connection ${ref}`)
  await orca.storage.set(
    SERVERS_KEY,
    all.filter((c) => c.id !== ref),
  )
  // The entry is already gone; a secrets store that refuses to delete must not hide that.
  await orca.secrets.delete(passwordKey(ref)).catch(() => undefined)
  orca.panels.post('connections.changed', {})
}
