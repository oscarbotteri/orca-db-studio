// Seam C: render checks for the panel. Visual only; the worker's answers are stand-ins.
import { defineCheck } from 'orca/testing'
import {
  type ConnectionEntry,
  WORKSPACE_QUESTION_KEY,
  type NewQueryQuestion,
  type SchemaTree,
  SQLITE_FORM_REQUEST_KEY,
} from '../protocol'
import type { FormDraft } from './connection-form-state'
import { connectionKey, schemaKey } from './state'

const SHOP: ConnectionEntry = {
  ref: '/Users/dev/api/data/shop.db',
  name: 'shop.db',
  detail: 'data',
  origin: 'saved',
}
const ANALYTICS: ConnectionEntry = {
  ref: '/Users/dev/reports/analytics.sqlite3',
  name: 'analytics.sqlite3',
  detail: 'reports',
  origin: 'saved',
}

const SHOP_DB: ConnectionEntry = {
  ref: 'c1',
  name: 'Shop DB',
  detail: 'app@db.internal:5432/shop',
  origin: 'saved',
  label: { environment: 'prod', tone: 'danger' },
}

const API_WORKTREE: ConnectionEntry = {
  ref: 'env:DATABASE_URL:id-api',
  name: 'api',
  detail: 'app@localhost:5432/api_dev',
  origin: 'worktree',
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
  path: '',
  environment: 'prod',
  tone: 'danger',
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

const ALL = { saved: [ANALYTICS, SHOP_DB, SHOP], worktrees: [API_WORKTREE] }

const NEW_QUERY_QUESTION = {
  action: { kind: 'new-query' },
  workspaces: [
    { id: 'id-api', name: 'api' },
    { id: 'id-web', name: 'web' },
  ],
} satisfies NewQueryQuestion

export default defineCheck({
  empty: {
    requests: { 'connections.list': { saved: [], worktrees: [] } },
  },
  tree: {
    persisted: {
      plugin: {
        'explorer-expanded': [connectionKey(SHOP.ref), schemaKey(SHOP.ref, 'main')],
      },
    },
    requests: { 'connections.list': ALL, 'explorer.listObjects': SHOP_TREE },
  },
  'tree-dark': {
    theme: 'dark',
    requests: { 'connections.list': ALL },
  },
  'new-query-picker': {
    storage: { [WORKSPACE_QUESTION_KEY]: NEW_QUERY_QUESTION },
    requests: { 'connections.list': ALL },
  },
  'new-query-picker-dark': {
    theme: 'dark',
    storage: { [WORKSPACE_QUESTION_KEY]: NEW_QUERY_QUESTION },
    requests: { 'connections.list': ALL },
  },
  'sqlite-form': {
    storage: { [SQLITE_FORM_REQUEST_KEY]: true },
    requests: { 'connections.list': ALL, 'sqlite.findFiles': FOUND_FILES },
  },
  'sqlite-edit-dark': {
    theme: 'dark',
    persisted: {
      plugin: {
        'connection-form': {
          ...FILLED_FORM,
          ref: SHOP.ref,
          hasPassword: false,
          name: SHOP.name,
          engine: 'sqlite',
          path: SHOP.ref,
        },
      },
    },
    requests: { 'connections.list': ALL },
  },
  form: {
    persisted: { plugin: { 'connection-form': FILLED_FORM } },
    requests: { 'connections.list': ALL },
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
    requests: { 'connections.list': ALL },
  },
})
