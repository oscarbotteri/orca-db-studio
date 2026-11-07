// Parses postgres://, postgresql:// and mysql:// URLs into the fields of the connection form. C2
import type { ServerEngine } from './protocol'

export const DEFAULT_PORTS: Record<ServerEngine, number> = { postgres: 5432, mysql: 3306 }

export interface ParsedConnectionString {
  engine: ServerEngine
  host: string
  port: number
  database: string
  user: string
  password: string
}

const SCHEMES: Record<string, ServerEngine> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
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
  return {
    engine,
    host: decode(url.hostname.replace(/^\[(.*)\]$/, '$1')),
    port: url.port ? Number(url.port) : DEFAULT_PORTS[engine],
    database: decode(url.pathname.replace(/^\//, '')),
    user: decode(url.username),
    password: decode(url.password),
  }
}
