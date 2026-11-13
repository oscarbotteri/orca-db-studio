// pasteConnectionString threads a pasted sslmode into the draft and clears a stale override. C2, C6
import { read } from 'orca'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  closeForm,
  formDraft,
  openNewForm,
  pasteConnectionString,
} from '../../src/panel/connection-form-state'

beforeEach(() => {
  closeForm()
  openNewForm('postgres')
})

describe('pasteConnectionString SSL', () => {
  test('carries sslmode=require into the draft', () => {
    pasteConnectionString('postgres://u:p@h.rds.amazonaws.com:5432/db?sslmode=require')
    expect(read(formDraft)?.ssl).toBe(true)
  })

  test('carries sslmode=disable into the draft', () => {
    pasteConnectionString('postgres://u:p@h:5432/db?sslmode=disable')
    expect(read(formDraft)?.ssl).toBe(false)
  })

  test('a replacement URL without sslmode clears a previous override', () => {
    pasteConnectionString('postgres://u:p@h:5432/db?sslmode=disable')
    expect(read(formDraft)?.ssl).toBe(false)
    pasteConnectionString('postgres://u:p@h.rds.amazonaws.com:5432/db')
    expect(read(formDraft)?.ssl).toBeUndefined()
  })
})
