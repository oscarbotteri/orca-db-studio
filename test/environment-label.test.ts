// The environment label's shared rules: default tones and the text it adds beside a connection. C5
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_TONE,
  ENVIRONMENTS,
  optionText,
  panelDescription,
  TONES,
} from '../src/environment-label'
import type { ConnectionEntry } from '../src/protocol'

const BILLING: ConnectionEntry = {
  ref: 'c1',
  name: 'Billing DB',
  detail: 'user@host:5432/db',
  origin: 'saved',
}
const PROD = { ...BILLING, label: { environment: 'prod', tone: 'danger' } } as const

describe('environments and tones', () => {
  test('offers the four environments and Orca five tones', () => {
    expect(ENVIRONMENTS).toEqual(['local', 'dev', 'staging', 'prod'])
    expect(TONES).toEqual(['neutral', 'accent', 'success', 'warning', 'danger'])
  })

  test('each environment starts on its default tone', () => {
    expect(DEFAULT_TONE).toEqual({
      local: 'success',
      dev: 'accent',
      staging: 'warning',
      prod: 'danger',
    })
  })
})

describe('panelDescription', () => {
  test('starts with the label when the connection has one', () => {
    expect(panelDescription(PROD)).toBe('prod · user@host:5432/db')
  })

  test('is the detail alone without a label', () => {
    expect(panelDescription(BILLING)).toBe('user@host:5432/db')
  })

  test('keeps the .env marker of a worktree connection first', () => {
    expect(panelDescription({ ...BILLING, origin: 'worktree' })).toBe('.env · user@host:5432/db')
  })
})

describe('optionText', () => {
  test('shows the label after the name', () => {
    expect(optionText(PROD)).toBe('Billing DB [prod] (user@host:5432/db)')
  })

  test('is the name and detail without a label', () => {
    expect(optionText(BILLING)).toBe('Billing DB (user@host:5432/db)')
  })
})
