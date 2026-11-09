// Worktree connections: the connection variable read from each local workspace's .env files on
// every use. Nothing read here is stored; the password stays in memory for the session. C4
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { parseConnectionString } from '../connection-string'
import type { ConnectionConfig } from '../drivers'
import type { ConnectionEntry } from '../protocol'
import { listLocalWorkspaces } from './local-workspaces'

const DEFAULT_VARIABLE = 'DATABASE_URL'
/** `.env.local` is listed last: it wins. */
const ENV_FILES = ['.env', '.env.local']
const REF_PREFIX = 'env:'

/** Where a worktree connection points, and the secret that opens it. */
export interface WorktreeTarget {
  config: ConnectionConfig
  password: string | undefined
  /** Where it points without the password, for the panel. */
  detail: string
  /** The URL as read; a different one means the target moved. */
  url: string
}

export interface WorktreeRef {
  variable: string
  workspaceId: string
}

/** The ref names the variable and the workspace id, so a document finds its workspace again. */
export function worktreeRef({ variable, workspaceId }: WorktreeRef): string {
  return `${REF_PREFIX}${encodeURIComponent(variable)}:${encodeURIComponent(workspaceId)}`
}

export function parseWorktreeRef(ref: string): WorktreeRef | undefined {
  if (!ref.startsWith(REF_PREFIX)) return undefined
  const [variable, workspaceId, ...rest] = ref.slice(REF_PREFIX.length).split(':')
  if (!variable || !workspaceId || rest.length > 0) return undefined
  try {
    return { variable: decodeURIComponent(variable), workspaceId: decodeURIComponent(workspaceId) }
  } catch {
    return undefined
  }
}

function unquote(raw: string): string {
  const value = raw.trim()
  const quote = value[0]
  if (quote === '"' || quote === "'") {
    // A double-quoted value may hold the quote escaped.
    const closing = quote === '"' ? /(?<!\\)"/ : /'/
    const end = value.slice(1).search(closing)
    if (end >= 0) return value.slice(1, end + 1).replaceAll(`\\${quote}`, quote)
  }
  // An unquoted value ends at a comment.
  return value.replace(/\s+#.*$/, '')
}

/** The value of `variable` in dotenv text; the last definition wins. */
export function readVariable(text: string, variable: string): string | undefined {
  let found: string | undefined
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(line)
    if (match?.[1] === variable) found = unquote(match[2] ?? '')
  }
  return found
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function variableIn(dir: string, variable: string): Promise<string | undefined> {
  let value: string | undefined
  for (const file of ENV_FILES) {
    value = readVariable(await readFileOrEmpty(join(dir, file)), variable) ?? value
  }
  return value
}

async function variableName(orca: OrcaWorkerApi): Promise<string> {
  const setting = await orca.settings.get('envVariable')
  return typeof setting === 'string' && setting.trim() ? setting.trim() : DEFAULT_VARIABLE
}

function targetOf(url: string | undefined): WorktreeTarget | undefined {
  const parsed = url ? parseConnectionString(url) : undefined
  if (!url || !parsed) return undefined
  const { password, engine, host, port, database, user } = parsed
  return {
    config: { engine, host, port, database, user },
    password: password || undefined,
    detail: `${user ? `${user}@` : ''}${host}:${port}${database ? `/${database}` : ''}`,
    url,
  }
}

/** One entry per local workspace whose .env files hold a supported URL. */
export async function listWorktreeConnections(orca: OrcaWorkerApi): Promise<ConnectionEntry[]> {
  const variable = await variableName(orca)
  const entries: ConnectionEntry[] = []
  for (const workspace of await listLocalWorkspaces(orca)) {
    const target = targetOf(await variableIn(workspace.path, variable))
    if (!target) continue
    entries.push({
      ref: worktreeRef({ variable, workspaceId: workspace.id }),
      name: workspace.name,
      detail: target.detail,
      origin: 'worktree',
    })
  }
  return entries
}

/** Reads the workspace's files now; rejects when it no longer offers a connection. */
export async function resolveWorktree(
  orca: OrcaWorkerApi,
  ref: WorktreeRef,
): Promise<WorktreeTarget> {
  // A document may name any variable; only the configured one is read, as the panel lists it.
  if (ref.variable !== (await variableName(orca))) {
    throw new Error(`${ref.variable} is not the configured connection variable`)
  }
  const workspace = (await listLocalWorkspaces(orca)).find((w) => w.id === ref.workspaceId)
  if (!workspace) throw new Error('That workspace is no longer open')
  const target = targetOf(await variableIn(workspace.path, ref.variable))
  if (!target) {
    throw new Error(
      `${ref.variable} is not a PostgreSQL or MySQL URL in ${workspace.name}'s .env files`,
    )
  }
  return target
}
