// Generates the PostgreSQL rows of the manual QA shop from shop-data.ts, so they match the
// SQLite shop. compose.yaml mounts the file into the init directory.
// Usage: node test/qa/seed-postgres.ts [output-path]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  categories,
  customers,
  EVENT_COUNT,
  event,
  orderItems,
  orders,
  products,
  typeSamples,
} from './shop-data.ts'

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(process.argv[2] ?? `${here}/data/postgres-data.sql`)
const BATCH_SIZE = 1000

function literal(value: unknown): string {
  if (value === null) return 'NULL'
  if (value instanceof Uint8Array) return `'\\x${Buffer.from(value).toString('hex')}'`
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function insertAll(table: string, rows: Iterable<object>): string {
  const statements: string[] = []
  let columns = ''
  let batch: string[] = []
  const flush = (): void => {
    if (batch.length > 0)
      statements.push(`INSERT INTO ${table} (${columns}) VALUES\n${batch.join(',\n')};`)
    batch = []
  }
  for (const row of rows) {
    columns = Object.keys(row).join(', ')
    batch.push(`(${Object.values(row).map(literal).join(', ')})`)
    if (batch.length === BATCH_SIZE) flush()
  }
  flush()
  return statements.join('\n')
}

const sql = [
  insertAll('categories', categories),
  insertAll('products', products),
  insertAll('customers', customers),
  insertAll('orders', orders),
  insertAll('order_items', orderItems),
  insertAll(
    'events',
    Array.from({ length: EVENT_COUNT }, (_, i) => event(i)),
  ),
  insertAll('type_samples', typeSamples),
].join('\n')

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `SET TIME ZONE 'UTC';\nBEGIN;\n${sql}\nCOMMIT;\n`)

process.stdout.write(`Wrote ${output}\n`)
