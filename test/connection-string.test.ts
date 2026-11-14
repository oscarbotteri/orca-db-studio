// C2: which fields a pasted connection string fills, and the encryption it asks for.
import { describe, expect, test } from 'vitest'
import { parseConnectionString } from '../src/connection-string'

const NEON =
  'postgresql://app:s3cret@ep-cool-rain.eu-central-1.aws.neon.tech/shop?sslmode=require&channel_binding=require'

describe('parseConnectionString', () => {
  test('reads a hosted URL and the sslmode it carries', () => {
    expect(parseConnectionString(NEON)).toEqual({
      engine: 'postgres',
      host: 'ep-cool-rain.eu-central-1.aws.neon.tech',
      port: 5432,
      database: 'shop',
      user: 'app',
      password: 's3cret',
      ssl: 'require',
    })
  })

  test('a URL without an ssl parameter asks for no encryption at all', () => {
    const parsed = parseConnectionString('postgres://app:pw@db.local:5433/shop')

    expect(parsed).not.toHaveProperty('ssl')
    expect(parsed?.port).toBe(5433)
  })

  test('every spelling lands on one of the three modes the form offers', () => {
    const mode = (query: string) => parseConnectionString(`postgres://u@h/db?${query}`)?.ssl

    expect(mode('sslmode=disable')).toBe('disable')
    expect(mode('sslmode=require')).toBe('require')
    expect(mode('sslmode=verify-ca')).toBe('verify-full')
    expect(mode('sslmode=verify-full')).toBe('verify-full')
    expect(mode('sslmode=prefer')).toBe('require')
    expect(mode('ssl=true')).toBe('require')
    expect(mode('ssl=0')).toBe('disable')
  })

  test('an sslmode this plugin does not know is left out, not guessed', () => {
    expect(parseConnectionString('postgres://u@h/db?sslmode=bogus')).not.toHaveProperty('ssl')
  })

  test('decodes a password with reserved characters', () => {
    const parsed = parseConnectionString('mysql://root:p%40ss%2Fword@127.0.0.1/app')

    expect(parsed).toMatchObject({ engine: 'mysql', port: 3306, password: 'p@ss/word' })
  })
})
