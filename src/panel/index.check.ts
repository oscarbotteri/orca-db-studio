// Seam C: render checks for the panel. Visual only; the worker's answers are stand-ins.
import { defineCheck } from 'orca/testing'
import { CHOOSER_REQUEST_KEY, type ConnectionEntry, type SchemaTree } from '../protocol'
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
    requests: { 'connections.list': { sqliteFiles: [] } },
  },
  tree: {
    persisted: {
      plugin: {
        'explorer-expanded': [connectionKey(SHOP.ref), schemaKey(SHOP.ref, 'main')],
      },
    },
    requests: {
      'connections.list': { sqliteFiles: [SHOP, ANALYTICS] },
      'explorer.listObjects': SHOP_TREE,
    },
  },
  chooser: {
    storage: { [CHOOSER_REQUEST_KEY]: true },
    requests: {
      'connections.list': { sqliteFiles: [SHOP] },
      'sqlite.findFiles': FOUND_FILES,
    },
  },
  'chooser-dark': {
    theme: 'dark',
    storage: { [CHOOSER_REQUEST_KEY]: true },
    requests: {
      'connections.list': { sqliteFiles: [] },
      'sqlite.findFiles': { files: [] },
    },
  },
})
