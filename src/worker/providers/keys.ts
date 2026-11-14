// The API tokens a hosted provider needs: read from a pasted token or from a file's .env line,
// and stored in secrets as a list of accounts, each with the name its selector shows.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Provider, ProviderKey } from '../../protocol'

/** What is kept per token: the token itself, and how the panel names that account. */
export type StoredKey = { token: string; label: string }

/** Where the keys of each provider are kept; a JSON list, never in storage. */
function secretKey(provider: Provider): string {
  return `provider:${provider}:keys`
}

/** The prefix a token of each provider starts with, when it has one. */
const PREFIXES: Record<Provider, string> = { neon: 'napi_', supabase: 'sbp_' }

/** A token as the person can be shown it: enough to recognise it, never the whole thing. */
export function maskKey(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 2)}…`
  return `${token.slice(0, 7)}…${token.slice(-4)}`
}

/** A stable id for a token, so the panel can pick one without ever holding it. */
export function keyId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12)
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path
}

/** Whether the text is a path to a file rather than a token: one word, and no spaces or `=`. */
function looksLikePath(text: string): boolean {
  if (/\s|="/.test(text)) return false
  return text.startsWith('/') || text.startsWith('~/') || isAbsolute(text)
}

/** The token a .env text holds: the one with the provider's prefix, else the first key-looking one. */
export function tokenInEnv(text: string, provider: Provider): string | undefined {
  const prefix = PREFIXES[provider]
  let fallback: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1] ?? ''
    const value = (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '')
    if (!value) continue
    if (value.startsWith(prefix)) return value
    if (fallback === undefined && /(KEY|TOKEN|SECRET)/i.test(name)) fallback = value
  }
  return fallback
}

/**
 * What the person typed in the token field: the token itself, the path to a file that holds it,
 * or the contents of one pasted by mistake. Nothing is stored until it looks usable.
 */
export async function resolveKeyInput(input: string, provider: Provider): Promise<string> {
  const text = input.trim()
  if (!text) throw new Error('Paste a token, or the path of a file that holds it')
  const prefix = PREFIXES[provider]
  if (text.startsWith(prefix)) return text
  const envPasted = text.includes('\n') || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text)
  if (!envPasted && looksLikePath(text)) {
    const path = expandHome(text)
    const contents = await readFile(path, 'utf8').catch(() => {
      throw new Error(`Could not read ${path}`)
    })
    const found = tokenInEnv(contents, provider)
    if (!found) throw new Error(`${path} holds no ${provider} token`)
    return found
  }
  if (envPasted) {
    const found = tokenInEnv(text, provider)
    if (!found) throw new Error(`That does not look like a ${provider} token`)
    return found
  }
  // A token without the documented prefix: accepted, the API is the judge.
  return text
}

/** The stored accounts; a record saved before accounts had names is a bare token. */
export async function readKeys(orca: OrcaWorkerApi, provider: Provider): Promise<StoredKey[]> {
  const raw = await orca.secrets.get(secretKey(provider))
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const keys: StoredKey[] = []
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      keys.push({ token: entry, label: maskKey(entry) })
      continue
    }
    if (typeof entry !== 'object' || entry === null || !('token' in entry)) continue
    const { token, label } = entry as { token?: unknown; label?: unknown }
    if (typeof token !== 'string') continue
    keys.push({ token, label: typeof label === 'string' && label ? label : maskKey(token) })
  }
  return keys
}

async function writeKeys(
  orca: OrcaWorkerApi,
  provider: Provider,
  keys: StoredKey[],
): Promise<void> {
  if (keys.length === 0) await orca.secrets.delete(secretKey(provider))
  else await orca.secrets.set(secretKey(provider), JSON.stringify(keys))
}

/** The accounts the panel offers in its selector. */
export async function listKeys(orca: OrcaWorkerApi, provider: Provider): Promise<ProviderKey[]> {
  return (await readKeys(orca, provider)).map(({ token, label }) => ({
    id: keyId(token),
    masked: maskKey(token),
    label,
  }))
}

/** The tokens to use: the one the panel picked, or every one stored when it picked none. */
export async function tokensOf(
  orca: OrcaWorkerApi,
  provider: Provider,
  id?: string,
): Promise<string[]> {
  const keys = await readKeys(orca, provider)
  if (id === undefined) return keys.map((key) => key.token)
  return keys.filter((key) => keyId(key.token) === id).map((key) => key.token)
}

/** Stores a token under the account name it answers to; the same token is not added twice. */
export async function addKey(
  orca: OrcaWorkerApi,
  provider: Provider,
  input: string,
  labelOf: (token: string) => Promise<string>,
): Promise<void> {
  const token = await resolveKeyInput(input, provider)
  const keys = await readKeys(orca, provider)
  if (keys.some((key) => key.token === token)) return
  const label = await labelOf(token).catch(() => '')
  await writeKeys(orca, provider, [...keys, { token, label: label || maskKey(token) }])
}

/** Forgets one account, or every one when no id is given. */
export async function clearKeys(
  orca: OrcaWorkerApi,
  provider: Provider,
  id?: string,
): Promise<void> {
  const keys = await readKeys(orca, provider)
  if (id === undefined) {
    await writeKeys(orca, provider, [])
    return
  }
  await writeKeys(
    orca,
    provider,
    keys.filter((key) => keyId(key.token) !== id),
  )
}
