// Seam C: render checks for the panel. Visual only; the worker's answers are stand-ins.
import { defineCheck } from 'orca/testing'
import { CHOOSER_REQUEST_KEY, type ConnectionEntry, type SchemaTree } from '../protocol'
import type { FormDraft } from './connection-form-state'
import { connectionKey, schemaKey } from './state'

const SHOP: ConnectionEntry = {
  ref: '/Users/dev/api/data/shop.db',
  name: 'shop.db',
  detail: 'data',
}
const ANALYTICS: ConnectionEntry = {
  ref: '/Users/dev/reports/analytics.sqlite3',
  name: 'analytics.sqlite3',
  detail: 'reports',
}

const SHOP_DB: ConnectionEntry = {
  ref: 'c1',
  name: 'Shop DB',
  detail: 'app@db.internal:5432/shop',
}

const FILLED_FORM: FormDraft = {
  ref: 'c1',
  hasPassword: true,
  name: 'Shop DB',
  engine: 'postgres',
  host: 'db.internal',
  port: '5432',
  database: 'shop',
  user: 'app',
  notice: null,
}

const SHOP_TREE: SchemaTree = {
  schemas: [
    {
      name: 'main',
      objects: [
        { name: 'customers', kind: 'table' },
        { name: 'order_items', kind: 'table' },
        { name: 'orders', kind: 'table' },
        { name: 'recent_orders', kind: 'view' },
      ],
    },
  ],
}

const FOUND_FILES = {
  files: [
    { path: '/Users/dev/api/app.db', relativePath: 'app.db', workspaceName: 'api' },
    {
      path: '/Users/dev/api/data/cache.sqlite3',
      relativePath: 'data/cache.sqlite3',
      workspaceName: 'api',
    },
    { path: '/Users/dev/web/dev.db3', relativePath: 'dev.db3', workspaceName: 'web' },
  ],
}

export default defineCheck({
  empty: {
    requests: { 'connections.list': { sqliteFiles: [], servers: [] } },
  },
  tree: {
    persisted: {
      plugin: {
        'explorer-expanded': [connectionKey(SHOP.ref), schemaKey(SHOP.ref, 'main')],
      },
    },
    requests: {
      'connections.list': { sqliteFiles: [SHOP, ANALYTICS], servers: [] },
      'explorer.listObjects': SHOP_TREE,
    },
  },
  'remove-file': {
    persisted: { plugin: { 'sqlite-removal': { entry: SHOP, error: null } } },
    requests: { 'connections.list': { sqliteFiles: [SHOP, ANALYTICS], servers: [] } },
  },
  'remove-file-dark': {
    theme: 'dark',
    persisted: { plugin: { 'sqlite-removal': { entry: SHOP, error: null } } },
    requests: { 'connections.list': { sqliteFiles: [SHOP, ANALYTICS], servers: [] } },
  },
  chooser: {
    storage: { [CHOOSER_REQUEST_KEY]: true },
    requests: {
      'connections.list': { sqliteFiles: [SHOP], servers: [] },
      'sqlite.findFiles': FOUND_FILES,
    },
  },
  'chooser-dark': {
    theme: 'dark',
    storage: { [CHOOSER_REQUEST_KEY]: true },
    requests: {
      'connections.list': { sqliteFiles: [], servers: [] },
      'sqlite.findFiles': { files: [] },
    },
  },
  form: {
    persisted: { plugin: { 'connection-form': FILLED_FORM } },
    requests: { 'connections.list': { sqliteFiles: [], servers: [SHOP_DB] } },
  },
  'form-error': {
    theme: 'dark',
    persisted: {
      plugin: {
        'connection-form': {
          ...FILLED_FORM,
          notice: {
            tone: 'danger',
            text: "Orca's secrets store is unavailable on this system, so a password cannot be saved. Save the connection without a password.",
          },
        },
      },
    },
    requests: { 'connections.list': { sqliteFiles: [], servers: [SHOP_DB] } },
  },
})
