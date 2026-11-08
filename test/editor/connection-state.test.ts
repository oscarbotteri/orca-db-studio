// When a query document must offer the connection chooser, and what it says.
import { describe, expect, test } from 'vitest'
import { chooserState, connectionEntries } from '../../src/editor/connection-state'

const SHOP = { ref: '/data/shop.db', name: 'shop.db', detail: 'data' }

const PG = { ref: 'a5f226d7', name: 'shop', detail: '127.0.0.1:54329/shop' }

describe('connectionEntries', () => {
  test('lists SQLite files and saved servers together', () => {
    expect(connectionEntries({ sqliteFiles: [SHOP], servers: [PG] })).toEqual([SHOP, PG])
  })

  test('a saved server is not reported as gone by the chooser', () => {
    const entries = connectionEntries({ sqliteFiles: [], servers: [PG] })
    expect(chooserState(PG.ref, entries, false)).toEqual({ needsChoice: false, notice: undefined })
  })
})

describe('chooserState', () => {
  test('a file without a connection line needs a choice and says nothing', () => {
    expect(chooserState(undefined, [SHOP], false)).toEqual({ needsChoice: true, notice: undefined })
  })

  test('a line naming a registered connection needs no choice', () => {
    expect(chooserState(SHOP.ref, [SHOP], false)).toEqual({ needsChoice: false, notice: undefined })
  })

  test('a line naming a connection the registry lost needs a choice, with a notice', () => {
    const state = chooserState('/gone.db', [SHOP], false)
    expect(state.needsChoice).toBe(true)
    expect(state.notice).toContain('/gone.db')
  })

  test('an empty registry points to the panel', () => {
    expect(chooserState(undefined, [], false).notice).toContain('DB Studio panel')
  })

  test('an unlistable registry leaves the document line standing', () => {
    expect(chooserState('/gone.db', undefined, false)).toEqual({
      needsChoice: false,
      notice: undefined,
    })
  })

  test('a read-only file says it cannot take a connection', () => {
    expect(chooserState(undefined, [SHOP], true).notice).toContain('read-only')
  })
})
