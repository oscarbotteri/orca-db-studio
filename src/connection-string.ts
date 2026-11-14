// Parses postgres://, postgresql:// and mysql:// URLs into the fields of the connection form. C2
import type { SslMode } from './drivers'
import type { ServerEngine } from './protocol'

export const DEFAULT_PORTS: Record<ServerEngine, number> = { postgres: 5432, mysql: 3306 }

export interface ParsedConnectionString {
  engine: ServerEngine
  host: string
  port: number
  database: string
  user: string
  password: string
  /** Where the URL asked to encrypt, when it did. */
  ssl?: SslMode
}

const SCHEMES: Record<string, ServerEngine> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
}

/**
 * The sslmode values a URL carries, as the three the form offers. `prefer`, `allow` and
 * `no-verify` all end up encrypted; a server without a certificate then needs `disable` chosen
 * by hand, which the form is one click away from.
 */
const SSL_MODE_PARAMS: Record<string, SslMode> = {
  disable: 'disable',
  allow: 'require',
  prefer: 'require',
  require: 'require',
  'no-verify': 'require',
  'verify-ca': 'verify-full',
  'verify-full': 'verify-full',
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** `sslmode=require` and `ssl=true` are the two spellings a connection string uses. */
function sslOf(url: URL): SslMode | undefined {
  const mode = url.searchParams.get('sslmode')?.trim().toLowerCase()
  if (mode) return SSL_MODE_PARAMS[mode]
  const ssl = url.searchParams.get('ssl')?.trim().toLowerCase()
  if (ssl === 'true' || ssl === '1') return 'require'
  if (ssl === 'false' || ssl === '0') return 'disable'
  return undefined
}

/** Undefined when the text is not a connection string this plugin understands. */
export function parseConnectionString(text: string): ParsedConnectionString | undefined {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return undefined
  }
  const engine = SCHEMES[url.protocol]
  if (!engine || !url.hostname) return undefined
  const ssl = sslOf(url)
  return {
    engine,
    host: decode(url.hostname.replace(/^\[(.*)\]$/, '$1')),
    port: url.port ? Number(url.port) : DEFAULT_PORTS[engine],
    database: decode(url.pathname.replace(/^\//, '')),
    user: decode(url.username),
    password: decode(url.password),
    ...(ssl ? { ssl } : {}),
  }
}
