// Seam C: render checks for the panel. Visual only; the worker's answers are stand-ins.
import { defineCheck } from 'orca/testing'
import { type ConnectionEntry, type SchemaTree, SQLITE_FORM_REQUEST_KEY } from '../protocol'
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
  name: 'shop-api',
  detail: 'neondb_owner@ep-cool-rain.eu-central-1.aws.neon.tech:5432/neondb',
  origin: 'worktree',
  workspaceId: 'id-api',
}

const WEB_WORKTREE: ConnectionEntry = {
  ref: 'env:DATABASE_URL:id-web',
  name: 'neurotalent',
  detail: 'neondb_owner@ep-nameless-pond-pooler.c-4.eu-central-1.aws.neon.tech:5432/neondb',
  origin: 'worktree',
  workspaceId: 'id-web',
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
  ssl: 'disable',
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

const NEON_CLOUD: ConnectionEntry = {
  ref: 'cloud:neon:lucky-lab-13811214:neondb',
  name: 'shop-api',
  detail: 'neondb_owner@ep-wild-morning-batt6fmk-pooler.c-8.eu-central-1.aws.neon.tech:5432/neondb',
  origin: 'cloud',
}

const ALL = {
  saved: [ANALYTICS, SHOP_DB, SHOP],
  worktrees: [API_WORKTREE, WEB_WORKTREE],
  cloud: [NEON_CLOUD],
  activeWorkspaceId: 'id-api',
}

export default defineCheck({
  empty: {
    requests: { 'connections.list': { saved: [], worktrees: [], cloud: [] } },
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
  'neon-tab': {
    theme: 'dark',
    persisted: { plugin: { 'panel-tab': 'neon' } },
    requests: {
      'connections.list': ALL,
      'provider.view': {
        keys: [{ id: 'k1', masked: 'napi_ab…f456', label: 'acme-projects' }],
        selected: 'k1',
        projects: [
          { id: 'p1', name: 'neurotalent', detail: 'aws-eu-central-1 · PG 17' },
          { id: 'p2', name: 'shop-api', detail: 'aws-eu-central-1 · PG 16' },
        ],
      },
    },
  },
  'supabase-tab-error': {
    persisted: { plugin: { 'panel-tab': 'supabase' } },
    requests: {
      'connections.list': ALL,
      'provider.view': {
        keys: [{ id: 'k2', masked: 'sbp_ab…c789', label: 'acme' }],
        selected: 'k2',
        projects: [],
        error: 'Supabase refused the token (401). Check that it is a personal access token.',
      },
    },
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
