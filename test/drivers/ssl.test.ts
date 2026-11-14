// The sslmode vocabulary the drivers share: what Node's TLS layer gets, and which failure names a mode.
import { describe, expect, test } from 'vitest'
import { isSslMode, SSL_MODES, sslModeForError, tlsOptions } from '../../src/drivers/common/ssl'

describe('tlsOptions', () => {
  test('plain TCP for nothing and for disable', () => {
    expect(tlsOptions(undefined)).toBeUndefined()
    expect(tlsOptions('disable')).toBeUndefined()
  })

  test('require encrypts without checking the certificate the server offers', () => {
    expect(tlsOptions('require')).toEqual({ rejectUnauthorized: false })
  })

  test('verify-full encrypts and checks the certificate', () => {
    expect(tlsOptions('verify-full')).toEqual({ rejectUnauthorized: true })
  })
})

describe('isSslMode', () => {
  test('accepts exactly the modes the form offers', () => {
    expect(SSL_MODES.every(isSslMode)).toBe(true)
    expect(isSslMode('prefer')).toBe(false)
    expect(isSslMode('')).toBe(false)
    expect(isSslMode(undefined)).toBe(false)
  })
})

describe('sslModeForError', () => {
  test('a server that refuses the clear connection wants require', () => {
    expect(sslModeForError('connection is insecure (try using `sslmode=require`)')).toBe('require')
    expect(sslModeForError('FATAL: no pg_hba.conf entry for host, no encryption')).toBe('require')
    expect(sslModeForError('error: SSL required')).toBe('require')
  })

  test('a server without a certificate wants disable', () => {
    expect(sslModeForError('The server does not support SSL connections')).toBe('disable')
    expect(sslModeForError('Server does not support secure connection')).toBe('disable')
  })

  test('a failure about something else offers no fix', () => {
    expect(sslModeForError('password authentication failed for user "app"')).toBeUndefined()
    expect(sslModeForError('getaddrinfo ENOTFOUND db.internal')).toBeUndefined()
  })
})
