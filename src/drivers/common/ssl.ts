// TLS options for a server connection, derived from the sslmode the person chose.
import type { SslMode } from './config'

/** The modes the connection form offers, in the order it lists them. */
export const SSL_MODES: readonly SslMode[] = ['disable', 'require', 'verify-full']

export function isSslMode(value: unknown): value is SslMode {
  return value === 'disable' || value === 'require' || value === 'verify-full'
}

/**
 * What Node's TLS layer needs: `require` encrypts the connection without checking the server's
 * certificate (libpq's `require`, and what a hosted server such as Neon asks for), `verify-full`
 * also checks it against the system's CA store and the host name. `undefined` leaves the driver
 * on plain TCP, which is what `disable` means.
 */
export function tlsOptions(ssl: SslMode | undefined): { rejectUnauthorized: boolean } | undefined {
  if (ssl === 'require') return { rejectUnauthorized: false }
  if (ssl === 'verify-full') return { rejectUnauthorized: true }
  return undefined
}

/**
 * The mode a failed connection should try next, judging by what the server said: a server that
 * refuses plain TCP names `sslmode=require` in its answer, and one without a certificate says so.
 */
export function sslModeForError(message: string): SslMode | undefined {
  const noCertificate = /does not support (ssl|tls|secure connection)|no ssl support/i
  if (noCertificate.test(message)) return 'disable'
  const demandsEncryption =
    /insecure|sslmode|ssl required|require ssl|tls required|pg_hba|secure connection/i
  if (demandsEncryption.test(message)) return 'require'
  return undefined
}
