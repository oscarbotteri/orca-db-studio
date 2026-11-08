// Generates the manual QA shop as a SQLite file inside the workspace, so the panel's
// SQLite chooser finds it. Usage: node test/qa/seed-sqlite.ts [output-path]
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
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
const output = resolve(process.argv[2] ?? `${here}/data/shop.db`)

const SCHEMA = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories (id),
  price_cents INTEGER NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  status TEXT NOT NULL,
  placed_at TEXT NOT NULL
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE VIEW order_totals AS
  SELECT o.id AS order_id, o.customer_id, o.status, sum(i.quantity * i.unit_price_cents) AS total_cents
  FROM orders o JOIN order_items i ON i.order_id = o.id
  GROUP BY o.id;
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX events_customer_id ON events (customer_id);
CREATE TABLE type_samples (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  text_value TEXT,
  big_number INTEGER,
  json_value TEXT,
  zoned_at TEXT,
  blob_value BLOB
);
`

function insertAll(db: DatabaseSync, table: string, rows: Iterable<object>): void {
  let statement: ReturnType<DatabaseSync['prepare']> | undefined
  for (const row of rows) {
    const values = Object.values(row) as SQLInputValue[]
    statement ??= db.prepare(
      `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${values.map(() => '?').join(', ')})`,
    )
    statement.run(...values)
  }
}

mkdirSync(dirname(output), { recursive: true })
rmSync(output, { force: true })

const db = new DatabaseSync(output)
db.exec('PRAGMA foreign_keys = ON')
db.exec(SCHEMA)
db.exec('BEGIN')
insertAll(db, 'categories', categories)
insertAll(db, 'products', products)
insertAll(db, 'customers', customers)
insertAll(db, 'orders', orders)
insertAll(db, 'order_items', orderItems)
insertAll(
  db,
  'events',
  Array.from({ length: EVENT_COUNT }, (_, i) => event(i)),
)
insertAll(db, 'type_samples', typeSamples)
db.exec('COMMIT')
db.close()

process.stdout.write(`Wrote ${output}\n`)
