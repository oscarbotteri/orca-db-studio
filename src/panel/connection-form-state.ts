// The connection form's draft and the worker requests behind its buttons. C1, C2
import { atom, plugin, read, set, update } from 'orca'
import { DEFAULT_PORTS, parseConnectionString } from '../connection-string'
import type { ConnectionForm, ServerEngine } from '../protocol'
import { forgetObjects, loadExpandedObjects, refreshConnections } from './state'

export interface FormDraft {
  /** Set when editing a saved connection. */
  ref?: string
  /** An edit keeps the stored password when the field stays empty. */
  hasPassword: boolean
  name: string
  engine: ServerEngine
  host: string
  port: string
  database: string
  user: string
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

function notice(tone: 'success' | 'danger', text: string): FormDraft['notice'] {
  return { tone, text }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function blankDraft(): FormDraft {
  return {
    hasPassword: false,
    name: '',
    engine: 'postgres',
    host: '',
    port: String(DEFAULT_PORTS.postgres),
    database: '',
    user: '',
    notice: null,
  }
}

export function openNewForm(): void {
  set(editError, null)
  set(formPassword, '')
  set(formDraft, blankDraft())
}

export async function openEditForm(ref: string): Promise<void> {
  set(editError, null)
  try {
    const { form, hasPassword } = await plugin.request('connection.get', { ref })
    set(formPassword, '')
    set(formDraft, { ...form, port: String(form.port), ref, hasPassword, notice: null })
  } catch (error) {
    set(editError, errorMessage(error))
  }
}

export function closeForm(): void {
  set(formDraft, null)
  set(formPassword, '')
}

export function editDraft(changes: Partial<FormDraft>): void {
  update(formDraft, (draft) => (draft ? { ...draft, ...changes, notice: null } : draft))
}

export function setEngine(engine: ServerEngine): void {
  update(formDraft, (draft) => {
    if (!draft) return draft
    // A port still at the old engine's default follows the engine.
    const port =
      draft.port === String(DEFAULT_PORTS[draft.engine])
        ? String(DEFAULT_PORTS[engine])
        : draft.port
    return { ...draft, engine, port, notice: null }
  })
}

/** Pasted text that is a connection string fills every field it carries. */
export function pasteConnectionString(text: string): void {
  const parsed = parseConnectionString(text)
  if (!parsed) return
  const { password, port, ...fields } = parsed
  // A string without a user or database must not wipe what the person typed.
  const present = Object.entries(fields).filter(([, value]) => value !== '')
  editDraft({ ...Object.fromEntries(present), port: String(port) })
  if (password) set(formPassword, password)
}

function formOf(draft: FormDraft): ConnectionForm {
  const { name, engine, host, port, database, user } = draft
  return { name, engine, host, port: Number(port), database, user }
}

function input(draft: FormDraft) {
  const password = read(formPassword)
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
    forgetObjects(draft.ref)
    closeForm()
    await refreshConnections()
    loadExpandedObjects()
    return undefined
  })
}
