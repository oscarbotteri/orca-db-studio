// What a query document's toolbar and band say about its connection. C5
import { describe, expect, test } from 'vitest'
import { badgeModel } from '../../src/editor/environment-badge'
import type { ConnectionEntry } from '../../src/protocol'

const BILLING: ConnectionEntry = {
  ref: 'c1',
  name: 'Billing DB',
  detail: 'user@host:5432/db',
  origin: 'saved',
}

describe('badgeModel', () => {
  test('names the environment in its tone and asks for the band', () => {
    const entry: ConnectionEntry = { ...BILLING, label: { environment: 'prod', tone: 'danger' } }

    expect(badgeModel(entry)).toEqual({
      text: '[prod] Billing DB',
      tone: 'danger',
      band: true,
    })
  })

  test('follows the tone the person chose, not the environment', () => {
    const entry: ConnectionEntry = { ...BILLING, label: { environment: 'dev', tone: 'warning' } }

    expect(badgeModel(entry)).toMatchObject({ text: '[dev] Billing DB', tone: 'warning' })
  })

  test('a connection without an environment shows its name in a neutral tone and no band', () => {
    expect(badgeModel(BILLING)).toEqual({ text: 'Billing DB', tone: 'neutral', band: false })
  })

  test('a worktree connection never has a band', () => {
    expect(badgeModel({ ...BILLING, origin: 'worktree' })).toMatchObject({
      tone: 'neutral',
      band: false,
    })
  })

  test('nothing is shown while the document names no known connection', () => {
    expect(badgeModel(undefined)).toBeUndefined()
  })
})
