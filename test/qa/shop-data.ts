// Reference data for the manual QA shop. The PostgreSQL and MariaDB seeds reproduce
// this same data so every engine shows the same rows. Deterministic: no randomness.
// Property names match the column names, so a seed can insert a row as it is.

export const EVENT_COUNT = 50_000

export interface Category {
  name: string
}

export interface Product {
  name: string
  category_id: number
  price_cents: number
}

export interface Customer {
  name: string
  email: string
  phone: string | null
  created_at: string
}

export interface Order {
  customer_id: number
  status: string
  placed_at: string
}

export interface OrderItem {
  order_id: number
  product_id: number
  quantity: number
  unit_price_cents: number
}

export interface ShopEvent {
  customer_id: number
  event_type: string
  payload: string
  created_at: string
}

/** One row per edge case the grid has to render. `null` columns are the ones a row does not exercise. */
export interface TypeSample {
  label: string
  text_value: string | null
  big_number: bigint | null
  json_value: string | null
  zoned_at: string | null
  blob_value: Uint8Array | null
}

export const categories: Category[] = ['Books', 'Electronics', 'Garden', 'Kitchen', 'Toys'].map(
  (name) => ({ name }),
)

export const products: Product[] = [
  ['Paperback novel', 1, 1299],
  ['Cookbook', 1, 2450],
  ['USB-C cable', 2, 899],
  ['Wireless mouse', 2, 2999],
  ['Noise-cancelling headphones', 2, 19999],
  ['Garden hose', 3, 3500],
  ['Pruning shears', 3, 1850],
  ['Chef knife', 4, 6400],
  ['Cast iron pan', 4, 4200],
  ['Wooden blocks', 5, 2700],
  ['Jigsaw puzzle', 5, 1590],
  ['Plush octopus', 5, 1999],
].map(([name, category_id, price_cents]) => ({
  name: String(name),
  category_id: Number(category_id),
  price_cents: Number(price_cents),
}))

const FIRST_NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Edsger', 'Barbara', 'Dennis']
const LAST_NAMES = [
  'Lovelace',
  'Hopper',
  'Torvalds',
  'Hamilton',
  'Turing',
  'Dijkstra',
  'Liskov',
  'Ritchie',
]
const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled']
const EVENT_TYPES = ['page_view', 'click', 'add_to_cart', 'checkout', 'search', 'login']

const CUSTOMER_COUNT = 40
const ORDER_COUNT = 120

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function pick<T>(values: T[], index: number): T {
  return values[index % values.length] as T
}

/** A UTC timestamp `minutes` after 2024-01-01, as `YYYY-MM-DD HH:MM:SS`. */
export function timestamp(minutes: number): string {
  const d = new Date(Date.UTC(2024, 0, 1) + minutes * 60_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export const customers: Customer[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
  const first = pick(FIRST_NAMES, i)
  const last = pick(LAST_NAMES, Math.floor(i / FIRST_NAMES.length))
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}.${i + 1}@example.com`.toLowerCase(),
    // Every 7th customer has no phone number, so NULLs show up in a real table too.
    phone: i % 7 === 0 ? null : `+1-555-01${pad(i)}`,
    created_at: timestamp(i * 977),
  }
})

export const orders: Order[] = Array.from({ length: ORDER_COUNT }, (_, i) => ({
  customer_id: ((i * 7) % CUSTOMER_COUNT) + 1,
  status: pick(ORDER_STATUSES, i),
  placed_at: timestamp(1000 + i * 733),
}))

export const orderItems: OrderItem[] = orders.flatMap((_, i) =>
  Array.from({ length: (i % 4) + 1 }, (_, j) => {
    const productId = ((i * 3 + j * 5) % products.length) + 1
    return {
      order_id: i + 1,
      product_id: productId,
      quantity: ((i + j) % 3) + 1,
      unit_price_cents: (products[productId - 1] as Product).price_cents,
    }
  }),
)

export function event(i: number): ShopEvent {
  return {
    customer_id: ((i * 13) % CUSTOMER_COUNT) + 1,
    event_type: pick(EVENT_TYPES, i),
    payload: JSON.stringify({ path: `/p/${(i * 31) % 500}`, session: `s-${i % 997}` }),
    created_at: timestamp(i),
  }
}

function sample(label: string, columns: Partial<TypeSample>): TypeSample {
  return {
    text_value: null,
    big_number: null,
    json_value: null,
    zoned_at: null,
    blob_value: null,
    ...columns,
    label,
  }
}

export const typeSamples: TypeSample[] = [
  sample('null', {}),
  sample('empty string', { text_value: '', big_number: 0n, json_value: '{}' }),
  sample('very long text', {
    text_value: 'The quick brown fox jumps over the lazy dog. '.repeat(500),
  }),
  sample('unicode and emoji', {
    text_value: 'Zażółć gęślą jaźń · 日本語のテキスト · مرحبا · 🐙🚀👩‍👩‍👧‍👦',
  }),
  sample('bigint above 2^53', { big_number: 9007199254740993n }),
  sample('bigint min and max', {
    text_value: '-9223372036854775808 .. 9223372036854775807',
    big_number: 9223372036854775807n,
  }),
  sample('json', {
    // Written as text: a JS number literal would round the big value before it reached the file.
    json_value:
      '{"name":"Ada","tags":["a","b"],"nested":{"ok":true,"n":null},"big":9007199254740993}',
  }),
  sample('timestamp with zone', { zoned_at: '2024-03-15T10:30:00.123+02:00' }),
  sample('binary', { blob_value: Uint8Array.from([0x00, 0xde, 0xad, 0xbe, 0xef, 0xff]) }),
]
