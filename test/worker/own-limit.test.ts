// Unit tests for the own-LIMIT scan: the cases the request tests cannot reach cheaply.
import { describe, expect, test } from 'vitest'
import { hasOwnLimit } from '../../src/worker/own-limit'

describe('hasOwnLimit', () => {
  test.each([
    ['SELECT * FROM t LIMIT 5', true],
    ['select * from t limit 5 offset 2', true],
    ['WITH x AS (SELECT 1 LIMIT 1) SELECT * FROM x LIMIT 3', true],
    ['SELECT * FROM t', false],
    ['SELECT * FROM (SELECT * FROM t LIMIT 5)', false],
    ["SELECT 'a LIMIT 5'", false],
    ['SELECT "limit" FROM t', false],
    ['SELECT `limit` FROM t', false],
    ['SELECT t.limit FROM t', false],
    ['SELECT 1 -- LIMIT 5', false],
    ['SELECT 1 /* LIMIT 5 */', false],
    ['SELECT 1 /* LIMIT 5 */ LIMIT 2', true],
    ["SELECT 'it''s' FROM t LIMIT 2", true],
    ["SELECT 'unterminated LIMIT 5", false],
    ['SELECT 1 /* unterminated LIMIT 5', false],
    ['SELECT 1) FROM t LIMIT 5', true],
    ['SELECT limited FROM t', false],
  ])('%s', (sql, expected) => {
    expect(hasOwnLimit(sql)).toBe(expected)
  })
})
