// The connection form's draft and the worker requests behind its buttons. C1, C2, C3, X3
import { atom, plugin, read, set, update } from 'orca'
import { DEFAULT_PORTS, parseConnectionString } from '../connection-string'
import { DEFAULT_TONE } from '../environment-label'
import {
  type ConnectionForm,
  type Environment,
  type FoundSqliteFile,
  type ServerEngine,
  SQLITE_FORM_REQUEST_KEY,
  type Tone,
} from '../protocol'
import {
  collapse,
  forgetObjects,
  loadExpandedObjects,
  loadFoundFiles,
  refreshConnections,
} from './state'

export type Engine = ConnectionForm['engine']

/** One draft for every engine: a server's fields and a SQLite file's path, each kept on a switch. */
export interface FormDraft {
  /** Set when editing a saved connection. */
  ref?: string
  /** An edit keeps the stored password when the field stays empty. */
  hasPassword: boolean
  name: string
  engine: Engine
  host: string
  port: string
  database: string
  user: string
  path: string
  /** SSL from a pasted URL's sslmode; absent until a string carries it. No form toggle yet. */
  ssl?: boolean
  /** `''` is no environment, which leaves the color disabled. */
  environment: Environment | ''
  tone: Tone
  /** The last test result or failure, shown beside the buttons. */
  notice: { tone: 'success' | 'danger'; text: string } | null
}

/** Kept by Orca for the panel, so a half-filled form survives a tab switch. Never the password. */
export const formDraft = atom<FormDraft | null>('connection-form', null, { persist: 'plugin' })
/** Memory only: a password must not reach any persisted store. */
export const formPassword = atom('')
/** Why an edit form could not open; there is no draft to carry it. */
export const editError = atom<string | null>(null)
export const formBusy = atom<'testing' | 'saving' | null>(null)
/** Whether the form lists the SQLite files found in the workspaces. */
export const findingFiles = atom(false)
/** Set by the "Open SQLite File" command through storage, for a panel that was closed. */
const sqliteFormRequested = atom<boolean>(SQLITE_FORM_REQUEST_KEY, false, { persist: 'storage' })

function notice(tone: 'success' | 'danger', text: string): FormDraft['notice'] {
  return { tone, text }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function blankDraft(engine: Engine): FormDraft {
  return {
    hasPassword: false,
    name: '',
    engine,
    host: '',
    port: String(DEFAULT_PORTS.postgres),
    database: '',
    user: '',
    path: '',
    environment: '',
    tone: 'neutral',
    notice: null,
  }
}

export function openNewForm(engine: Engine = 'postgres'): void {
  set(editError, null)
  set(formPassword, '')
  set(findingFiles, false)
  set(formDraft, blankDraft(engine))
}

/**
 * The "Open SQLite File" command: a new connection on SQLite. A new connection already open turns
 * to SQLite and keeps what was typed; one being edited is left alone. X3
 */
export function openSqliteForm(): void {
  set(sqliteFormRequested, false)
  const draft = read(formDraft)
  if (!draft) openNewForm('sqlite')
  else if (draft.ref === undefined) setEngine('sqlite')
}

export function sqliteFormWasRequested(): boolean {
  return read(sqliteFormRequested)
}

export async function openEditForm(ref: string): Promise<void> {
  set(editError, null)
  try {
    const { form: saved, hasPassword } = await plugin.request('connection.get', { ref })
    const { label, ...form } = saved
    const fields = form.engine === 'sqlite' ? form : { ...form, port: String(form.port) }
    set(formPassword, '')
    set(findingFiles, false)
    set(formDraft, {
      ...blankDraft(form.engine),
      ...fields,
      ...(label ? { environment: label.environment, tone: label.tone } : {}),
      ref,
      hasPassword,
      notice: null,
    })
  } catch (error) {
    set(editError, errorMessage(error))
  }
}

export function closeForm(): void {
  set(formDraft, null)
  set(formPassword, '')
  set(findingFiles, false)
}

export function editDraft(changes: Partial<FormDraft>): void {
  update(formDraft, (draft) => (draft ? { ...draft, ...changes, notice: null } : draft))
}

function isServer(engine: Engine): engine is ServerEngine {
  return engine !== 'sqlite'
}

export function setEngine(engine: Engine): void {
  update(formDraft, (draft) => {
    if (!draft) return draft
    // A port still at the old engine's default follows the engine; SQLite has no port of its own.
    const stale = !isServer(draft.engine) || draft.port === String(DEFAULT_PORTS[draft.engine])
    const port = isServer(engine) && stale ? String(DEFAULT_PORTS[engine]) : draft.port
    // A draft persisted before SQLite joined the form has no path.
    const path = draft.path ?? ''
    return { ...draft, engine, port, path, notice: null }
  })
}

/** The environment brings its default color; the person can pick another one after. */
export function setEnvironment(environment: Environment | ''): void {
  editDraft({ environment, tone: environment === '' ? 'neutral' : DEFAULT_TONE[environment] })
}

export function findInWorkspaces(): void {
  set(findingFiles, true)
  void loadFoundFiles()
}

/** A found file fills the path, and the name when the person has not typed one. */
export function chooseFoundFile(file: FoundSqliteFile): void {
  const draft = read(formDraft)
  if (!draft) return
  const name = draft.name.trim() || (file.relativePath.split(/[\\/]/).pop() ?? '')
  editDraft({ path: file.path, name })
  set(findingFiles, false)
}

/** Pasted text that is a connection string fills every field it carries. */
export function pasteConnectionString(text: string): void {
  const parsed = parseConnectionString(text)
  if (!parsed) return
  const { password, port, ssl, ...fields } = parsed
  // A string without a user or database must not wipe what the person typed.
  const present = Object.entries(fields).filter(([, value]) => value !== '')
  // sslmode is carried through so a pasted require/disable reaches the driver, even on a
  // non-managed host the default would not cover. It is always assigned, including undefined, so
  // re-pasting a URL without sslmode clears a previous override and restores the host default.
  editDraft({ ...Object.fromEntries(present), port: String(port), ssl })
  if (password) set(formPassword, password)
}

function formOf(draft: FormDraft): ConnectionForm {
  const { name, engine, host, port, database, user, path, ssl, environment, tone } = draft
  // A draft persisted before labels joined the form has neither field.
  const label = environment ? { label: { environment, tone: tone ?? 'neutral' } } : {}
  if (!isServer(engine)) return { name, engine, path, ...label }
  // sslmode travels only when a pasted URL set it; absent lets the driver decide from the host.
  const sslField = ssl === undefined ? {} : { ssl }
  return { name, engine, host, port: Number(port), database, user, ...sslField, ...label }
}

function input(draft: FormDraft) {
  // A field typed before switching to SQLite must not travel with it.
  const password = isServer(draft.engine) ? read(formPassword) : ''
  return {
    ...(draft.ref === undefined ? {} : { ref: draft.ref }),
    form: formOf(draft),
    ...(password ? { password } : {}),
  }
}

async function run(
  busy: 'testing' | 'saving',
  action: (draft: FormDraft) => Promise<string | undefined>,
): Promise<void> {
  const draft = read(formDraft)
  if (!draft || read(formBusy)) return
  set(formBusy, busy)
  try {
    const text = await action(draft)
    if (text !== undefined) update(formDraft, (d) => d && { ...d, notice: notice('success', text) })
  } catch (error) {
    update(formDraft, (d) => d && { ...d, notice: notice('danger', errorMessage(error)) })
  } finally {
    set(formBusy, null)
  }
}

export function testForm(): Promise<void> {
  return run('testing', async (draft) => {
    await plugin.request('connection.test', input(draft))
    return 'Connection works'
  })
}

export function saveForm(): Promise<void> {
  return run('saving', async (draft) => {
    await plugin.request('connection.save', input(draft))
    if (draft.ref !== undefined) forgetObjects(draft.ref)
    closeForm()
    await refreshConnections()
    loadExpandedObjects()
    return undefined
  })
}

export function deleteFromForm(): Promise<void> {
  return run('saving', async (draft) => {
    if (draft.ref === undefined) return undefined
    await plugin.request('connection.delete', { ref: draft.ref })
    collapse(draft.ref)
    forgetObjects(draft.ref)
    closeForm()
    await refreshConnections()
    loadExpandedObjects()
    return undefined
  })
}
