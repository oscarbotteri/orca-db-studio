// Writes the MariaDB seed rows (data/mariadb-data.sql) from the shared shop data, for the
// container's init directory. Usage: node test/qa/seed-mariadb.ts [output-path]
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
  type TypeSample,
  typeSamples,
} from './shop-data.ts'

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(process.argv[2] ?? `${here}/data/mariadb-data.sql`)
const BATCH_SIZE = 1000

type Value = string | number | bigint | null | Uint8Array

function literal(value: Value): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function* insert(table: string, rows: Iterable<object>): Generator<string> {
  let batch: string[] = []
  let columns = ''
  for (const row of rows) {
    columns ||= Object.keys(row).join(', ')
    batch.push(`(${(Object.values(row) as Value[]).map(literal).join(', ')})`)
    if (batch.length === BATCH_SIZE) {
      yield `INSERT INTO ${table} (${columns}) VALUES\n${batch.join(',\n')};\n`
      batch = []
    }
  }
  if (batch.length > 0) yield `INSERT INTO ${table} (${columns}) VALUES\n${batch.join(',\n')};\n`
}

/** DATETIME holds no offset, so the zoned sample is stored as its UTC instant. */
function inUtc(sample: TypeSample): TypeSample {
  if (sample.zoned_at === null) return sample
  const iso = new Date(sample.zoned_at).toISOString()
  return { ...sample, zoned_at: iso.slice(0, 23).replace('T', ' ') }
}

const statements = [
  'SET NAMES utf8mb4;\n',
  ...insert('categories', categories),
  ...insert('products', products),
  ...insert('customers', customers),
  ...insert('orders', orders),
  ...insert('order_items', orderItems),
  ...insert(
    'events',
    Array.from({ length: EVENT_COUNT }, (_, i) => event(i)),
  ),
  ...insert('type_samples', typeSamples.map(inUtc)),
]

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, statements.join('\n'))
process.stdout.write(`Wrote ${output}\n`)
