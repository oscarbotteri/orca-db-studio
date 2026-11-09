// The panel against a stand-in worker: what the person sees and which requests it makes.
import { hostError, mockHost, mount } from 'orca/testing'
import { describe, expect, test } from 'vitest'
import * as panel from '../../src/panel/index'
import { type ConnectionEntry, type SchemaTree, SQLITE_FORM_REQUEST_KEY } from '../../src/protocol'

const SHOP: ConnectionEntry = {
  ref: '/data/shop.db',
  name: 'shop.db',
  detail: 'data',
  origin: 'saved',
}
const API: ConnectionEntry = {
  ref: 'env:DATABASE_URL:w1',
  name: 'api',
  detail: 'app@db:5432/shop',
  origin: 'worktree',
}

const SHOP_TREE: SchemaTree = {
  schemas: [
    {
      name: 'main',
      objects: [
        { name: 'orders', kind: 'table' },
        { name: 'recent_orders', kind: 'view' },
      ],
    },
  ],
}

const FOUND = {
  files: [{ path: '/work/api/app.db', relativePath: 'app.db', workspaceName: 'api' }],
}

function treeItems(p: {
  find: (q: { role: string }) => { props: Record<string, unknown> } | null
}) {
  return p.find({ role: 'tree' })?.props.items as {
    key: string
    label: string
    description?: string
    icon?: string
  }[]
}

describe('connections list', () => {
  test('offers a new connection when there are none', async () => {
    const p = await mount(panel, {
      host: mockHost({ requests: { 'connections.list': { saved: [], worktrees: [] } } }),
    })

    expect(p.find({ label: 'No connections' })).not.toBeNull()
    await p.press({ text: 'New connection' })
    expect(p.find({ label: 'Name' })).not.toBeNull()
  })

  test('lists saved and worktree connections in one tree, each marked with its origin', async () => {
    const p = await mount(panel, {
      host: mockHost({ requests: { 'connections.list': { saved: [SHOP], worktrees: [API] } } }),
    })

    expect(p.findAll({ role: 'tree' })).toHaveLength(1)
    expect(p.find({ text: 'Worktree connections' })).toBeNull()
    expect(
      treeItems(p).map(({ label, description, icon }) => ({ label, description, icon })),
    ).toEqual([
      { label: 'shop.db', description: 'data', icon: 'database' },
      { label: 'api', description: '.env · app@db:5432/shop', icon: 'branch' },
    ])
  })

  test('expanding a connection shows its schemas, tables and views', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'explorer.listObjects': SHOP_TREE,
      },
    })
    const p = await mount(panel, { host })
    const tree = { role: 'tree' }
    const connectionKey = JSON.stringify(['connection', SHOP.ref])
    const schemaKey = JSON.stringify(['schema', SHOP.ref, 'main'])

    await p.expand(tree, connectionKey)
    await p.expand(tree, schemaKey)

    expect(p.find({ text: /orders/ })).not.toBeNull()
    expect(p.find({ text: /recent_orders/ })).not.toBeNull()
    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'explorer.listObjects',
      input: { ref: SHOP.ref },
    })
  })

  test('Enter on a worktree connection opens nothing', async () => {
    const host = mockHost({ requests: { 'connections.list': { saved: [], worktrees: [API] } } })
    const p = await mount(panel, { host })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', API.ref]))

    expect(p.find({ label: 'Name' })).toBeNull()
    expect(host.callsOf('plugin.request')).not.toContainEqual(
      expect.objectContaining({ name: 'connection.get' }),
    )
  })
})

describe('SQLite in the connection form', () => {
  const SQLITE_FORM = { name: 'shop.db', engine: 'sqlite' as const, path: '/data/shop.db' }

  async function mountWith(requests: Record<string, unknown> = {}, storage = {}) {
    const host = mockHost({
      storage,
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'sqlite.findFiles': FOUND,
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('choosing SQLite asks for a path instead of a server', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.select({ label: 'Engine' }, 'sqlite')

    expect(p.find({ label: 'Path' })).not.toBeNull()
    expect(p.find({ label: 'Host' })).toBeNull()
    expect(p.find({ label: 'Password' })).toBeNull()
    expect(p.find({ label: 'Connection string' })).toBeNull()
  })

  test('saves a pasted path with its name', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return SHOP
      },
    })

    await p.press({ label: 'New connection' })
    await p.select({ label: 'Engine' }, 'sqlite')
    await p.type({ label: 'Name' }, 'Shop')
    await p.type({ label: 'Path' }, '/data/shop.db')
    await p.press({ text: 'Save' })

    expect(saved).toEqual({ form: { name: 'Shop', engine: 'sqlite', path: '/data/shop.db' } })
    expect(p.find({ label: 'Path' })).toBeNull()
  })

  test('a file found in the workspaces fills the path, and the name when it is empty', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.select({ label: 'Engine' }, 'sqlite')
    await p.press({ text: 'Find in workspaces' })
    await p.press({ label: 'app.db' })

    expect(p.find({ label: 'Path' })?.props.value).toBe('/work/api/app.db')
    expect(p.find({ label: 'Name' })?.props.value).toBe('app.db')
  })

  test('shows why a file could not be saved and keeps the form open', async () => {
    const { p } = await mountWith({
      'connection.save': () => {
        throw hostError('action_failed', '/tmp/notes.txt is not a SQLite database')
      },
    })

    await p.press({ label: 'New connection' })
    await p.select({ label: 'Engine' }, 'sqlite')
    await p.type({ label: 'Name' }, 'Notes')
    await p.type({ label: 'Path' }, '/tmp/notes.txt')
    await p.press({ text: 'Save' })

    expect(p.find({ text: /is not a SQLite database/ })).not.toBeNull()
    expect(p.find({ label: 'Path' })).not.toBeNull()
  })

  test('Enter on a saved SQLite file edits it; Delete only forgets the file', async () => {
    let deleted: unknown
    const { p } = await mountWith({
      'connection.get': { form: SQLITE_FORM, hasPassword: false },
      'connection.delete': (input: unknown) => {
        deleted = input
        return {}
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))

    expect(p.find({ label: 'Path' })?.props.value).toBe('/data/shop.db')
    expect(p.find({ text: /stays on disk/ })).not.toBeNull()
    await p.press({ text: 'Delete' })
    expect(deleted).toEqual({ ref: SHOP.ref })
  })

  test('the Open SQLite File command opens the form on SQLite', async () => {
    const { host, p } = await mountWith({}, { [SQLITE_FORM_REQUEST_KEY]: true })

    expect(p.find({ label: 'Engine' })?.props.value).toBe('sqlite')
    expect(p.find({ label: 'Path' })).not.toBeNull()
    expect(host.data().storage[SQLITE_FORM_REQUEST_KEY]).toBe(false)
  })

  test('the command opens the form while the panel is open', async () => {
    const { p } = await mountWith()

    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Path' })).not.toBeNull()
  })

  test('switching from SQLite to MySQL gives the MySQL port', async () => {
    const { p } = await mountWith()

    await p.post('sqlite.formRequested', {})
    await p.select({ label: 'Engine' }, 'mysql')

    expect(p.find({ label: 'Port' })?.props.value).toBe('3306')
  })

  test('the command turns a new form to SQLite, keeping what was typed', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Name' }, 'Mine')
    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Engine' })?.props.value).toBe('sqlite')
    expect(p.find({ label: 'Name' })?.props.value).toBe('Mine')
  })

  test('the command leaves a connection being edited alone', async () => {
    const PG_EDIT = {
      name: 'Shop DB',
      engine: 'postgres' as const,
      host: 'db.internal',
      port: 5432,
      database: 'shop',
      user: 'app',
    }
    const { p } = await mountWith({ 'connection.get': { form: PG_EDIT, hasPassword: true } })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))
    await p.type({ label: 'Password' }, 'typed')
    await p.post('sqlite.formRequested', {})

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Password' })?.props.value).toBe('typed')
  })
})

describe('opening a table', () => {
  const tree = { role: 'tree' }
  const connectionKey = JSON.stringify(['connection', SHOP.ref])
  const ordersKey = JSON.stringify(['object', SHOP.ref, 'main', 'orders'])

  async function mountShop(open: (input: unknown) => unknown) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [SHOP], worktrees: [] },
        'explorer.listObjects': {
          schemas: [{ name: 'main', objects: [{ name: 'orders', kind: 'table' }] }],
        },
        'table.open': open as never,
      },
    })
    const p = await mount(panel, {
      host,
      persisted: {
        plugin: {
          'explorer-expanded': [connectionKey, JSON.stringify(['schema', SHOP.ref, 'main'])],
        },
      },
    })
    return { host, p }
  }

  test('asks the worker to open the table that was activated', async () => {
    const { host, p } = await mountShop(() => ({ status: 'opened', path: '.db-studio/orders.sql' }))

    await p.activateItem(tree, ordersKey)

    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'table.open',
      input: { ref: SHOP.ref, schema: 'main', table: 'orders' },
    })
  })

  test('offers the workspaces when the worker cannot pick one, then opens in the chosen one', async () => {
    const calls: unknown[] = []
    const { p } = await mountShop((input) => {
      calls.push(input)
      return calls.length === 1
        ? { status: 'choose-workspace', workspaces: [{ id: 'w1', name: 'api' }] }
        : { status: 'opened', path: '.db-studio/orders.sql' }
    })

    await p.activateItem(tree, ordersKey)
    await p.press({ label: 'api' })

    expect(calls[1]).toEqual({ ref: SHOP.ref, schema: 'main', table: 'orders', workspaceId: 'w1' })
    expect(p.find({ text: /Open in which workspace/ })).toBeNull()
  })

  test('shows why the table could not be opened', async () => {
    const { p } = await mountShop(() => {
      throw hostError('action_failed', 'Open a workspace to open a table')
    })

    await p.activateItem(tree, ordersKey)

    expect(p.find({ text: /Open a workspace to open a table/ })).not.toBeNull()
  })
})

describe('connection form', () => {
  const PG: ConnectionEntry = {
    ref: 'c1',
    name: 'Shop DB',
    detail: 'app@db.internal:5432/shop',
    origin: 'saved',
  }
  const FORM = {
    name: 'Shop DB',
    engine: 'postgres' as const,
    host: 'db.internal',
    port: 5432,
    database: 'shop',
    user: 'app',
  }

  async function mountWith(requests: Record<string, unknown> = {}) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [PG], worktrees: [] },
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('pasting a connection string fills every field it contains', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgresql://app:p%40ss@db.internal:6543/shop')

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Port' })?.props.value).toBe('6543')
    expect(p.find({ label: 'Database' })?.props.value).toBe('shop')
    expect(p.find({ label: 'User' })?.props.value).toBe('app')
    expect(p.find({ label: 'Password' })?.props.value).toBe('p@ss')
  })

  test('a mysql:// string selects MySQL with its default port', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'mysql://root@localhost/app')

    expect(p.find({ label: 'Engine' })?.props.value).toBe('mysql')
    expect(p.find({ label: 'Port' })?.props.value).toBe('3306')
  })

  test('saves the form values and the password through the worker', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return PG
      },
    })

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgres://app:pw@db.internal/shop')
    await p.type({ label: 'Name' }, 'Shop DB')
    await p.press({ text: 'Save' })

    expect(saved).toEqual({ form: FORM, password: 'pw' })
    expect(p.find({ label: 'Connection string' })).toBeNull()
  })

  test('shows why saving failed and keeps the form open', async () => {
    const { p } = await mountWith({
      'connection.save': () => {
        throw hostError('action_failed', "Orca's secrets store is unavailable")
      },
    })

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgres://app:pw@db.internal/shop')
    await p.type({ label: 'Name' }, 'Shop DB')
    await p.press({ text: 'Save' })

    expect(p.find({ text: /secrets store is unavailable/ })).not.toBeNull()
    expect(p.find({ label: 'Host' })).not.toBeNull()
  })

  test('tests the connection and reports the result', async () => {
    const { p } = await mountWith({ 'connection.test': () => ({}) })

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgres://app@db.internal/shop')
    await p.type({ label: 'Name' }, 'Shop DB')
    await p.press({ text: 'Test' })

    expect(p.find({ text: /Connection works/ })).not.toBeNull()
  })

  test('edits a saved connection without asking for its password again', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: true },
      'connection.save': (input: unknown) => {
        saved = input
        return PG
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))
    await p.type({ label: 'Host' }, 'db2.internal', { replace: true })
    await p.press({ text: 'Save' })

    expect(saved).toEqual({ ref: 'c1', form: { ...FORM, host: 'db2.internal' } })
  })

  test('deletes a saved connection', async () => {
    let deleted: unknown
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: false },
      'connection.delete': (input: unknown) => {
        deleted = input
        return {}
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))
    await p.press({ text: 'Delete' })

    expect(deleted).toEqual({ ref: 'c1' })
  })

  test('pasting a string without user or database keeps what was typed', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Database' }, 'shop')
    await p.type({ label: 'User' }, 'app')
    await p.type({ label: 'Connection string' }, 'postgres://db.internal:5432')

    expect(p.find({ label: 'Host' })?.props.value).toBe('db.internal')
    expect(p.find({ label: 'Database' })?.props.value).toBe('shop')
    expect(p.find({ label: 'User' })?.props.value).toBe('app')
  })

  test('an IPv6 host is filled without its brackets', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgres://app@[::1]:5432/shop')

    expect(p.find({ label: 'Host' })?.props.value).toBe('::1')
  })

  test('a failed load of a connection shows the error and opens no form', async () => {
    const { p } = await mountWith({
      'connection.get': () => {
        throw hostError('action_failed', 'secrets store failed')
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))

    expect(p.find({ text: /secrets store failed/ })).not.toBeNull()
    expect(p.find({ label: 'Host' })).toBeNull()
  })

  test('saving an edit reloads the tables the explorer had cached', async () => {
    let listed = 0
    const { p } = await mountWith({
      'connection.get': { form: FORM, hasPassword: true },
      'connection.save': PG,
      'explorer.listObjects': () => {
        listed += 1
        return { schemas: [] }
      },
    })
    const tree = { role: 'tree' }

    await p.expand(tree, JSON.stringify(['connection', 'c1']))
    await p.activateItem(tree, JSON.stringify(['connection', 'c1']))
    await p.press({ text: 'Save' })

    expect(listed).toBe(2)
  })

  test('opens a table on a saved connection', async () => {
    const { host, p } = await mountWith({
      'explorer.listObjects': {
        schemas: [{ name: 'public', objects: [{ name: 'users', kind: 'table' }] }],
      },
      'table.open': { status: 'opened', path: '.db-studio/users.sql' },
    })
    const tree = { role: 'tree' }

    await p.expand(tree, JSON.stringify(['connection', 'c1']))
    await p.expand(tree, JSON.stringify(['schema', 'c1', 'public']))
    await p.activateItem(tree, JSON.stringify(['object', 'c1', 'public', 'users']))

    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'table.open',
      input: { ref: 'c1', schema: 'public', table: 'users' },
    })
  })
})

describe('environment label', () => {
  const PROD_PG: ConnectionEntry = {
    ref: 'c1',
    name: 'Billing DB',
    detail: 'app@db:5432/billing',
    origin: 'saved',
    label: { environment: 'prod', tone: 'danger' },
  }
  const FORM = {
    name: 'Billing DB',
    engine: 'postgres' as const,
    host: 'db',
    port: 5432,
    database: 'billing',
    user: 'app',
  }

  async function mountWith(requests: Record<string, unknown> = {}) {
    const host = mockHost({
      requests: {
        'connections.list': { saved: [PROD_PG, SHOP], worktrees: [API] },
        ...requests,
      } as never,
    })
    return { host, p: await mount(panel, { host }) }
  }

  test('a connection row starts its description with the label', async () => {
    const { p } = await mountWith()

    expect(treeItems(p).map((item) => item.description)).toEqual([
      'prod · app@db:5432/billing',
      'data',
      '.env · app@db:5432/shop',
    ])
  })

  test('the form starts with no environment and a disabled color', async () => {
    const { p } = await mountWith()

    await p.press({ label: 'New connection' })

    expect(p.find({ label: 'Environment' })?.props.value).toBe('none')
    expect(p.find({ label: 'Color' })?.props.disabled).toBe(true)
  })

  test('choosing an environment enables the color and picks its default', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'New connection' })

    await p.select({ label: 'Environment' }, 'staging')

    expect(p.find({ label: 'Color' })?.props.disabled).toBeFalsy()
    expect(p.find({ label: 'Color' })?.props.value).toBe('warning')
  })

  test('changing the environment resets a color the person had picked', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'New connection' })
    await p.select({ label: 'Environment' }, 'dev')
    await p.select({ label: 'Color' }, 'neutral')

    await p.select({ label: 'Environment' }, 'prod')

    expect(p.find({ label: 'Color' })?.props.value).toBe('danger')
  })

  test('the color offers Orca five tones', async () => {
    const { p } = await mountWith()
    await p.press({ label: 'New connection' })

    const options = p.find({ label: 'Color' })?.props.options as { value: string }[]

    expect(options.map((o) => o.value)).toEqual([
      'neutral',
      'accent',
      'success',
      'warning',
      'danger',
    ])
  })

  test('saves the environment and the chosen color with the connection', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return PROD_PG
      },
    })

    await p.press({ label: 'New connection' })
    await p.type({ label: 'Connection string' }, 'postgres://app@db:5432/billing')
    await p.type({ label: 'Name' }, 'Billing DB')
    await p.select({ label: 'Environment' }, 'prod')
    await p.select({ label: 'Color' }, 'warning')
    await p.press({ text: 'Save' })

    expect(saved).toMatchObject({
      form: { name: 'Billing DB', label: { environment: 'prod', tone: 'warning' } },
    })
  })

  test('editing restores the saved environment and color', async () => {
    const { p } = await mountWith({
      'connection.get': {
        form: { ...FORM, label: { environment: 'dev', tone: 'neutral' } },
        hasPassword: true,
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))

    expect(p.find({ label: 'Environment' })?.props.value).toBe('dev')
    expect(p.find({ label: 'Color' })?.props.value).toBe('neutral')
  })

  test('a connection saved before labels existed opens with no environment', async () => {
    const { p } = await mountWith({ 'connection.get': { form: FORM, hasPassword: true } })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))

    expect(p.find({ label: 'Environment' })?.props.value).toBe('none')
    expect(p.find({ label: 'Color' })?.props.disabled).toBe(true)
  })

  test('choosing None again removes the label from what is saved', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.get': {
        form: { ...FORM, label: { environment: 'prod', tone: 'danger' } },
        hasPassword: true,
      },
      'connection.save': (input: unknown) => {
        saved = input
        return PROD_PG
      },
    })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', 'c1']))
    await p.select({ label: 'Environment' }, 'none')
    await p.press({ text: 'Save' })

    expect(saved).toEqual({ ref: 'c1', form: FORM })
  })

  test('a SQLite file can carry one too', async () => {
    let saved: unknown
    const { p } = await mountWith({
      'connection.save': (input: unknown) => {
        saved = input
        return SHOP
      },
    })

    await p.press({ label: 'New connection' })
    await p.select({ label: 'Engine' }, 'sqlite')
    await p.type({ label: 'Path' }, '/data/shop.db')
    await p.select({ label: 'Environment' }, 'local')
    await p.press({ text: 'Save' })

    expect(saved).toMatchObject({
      form: { engine: 'sqlite', label: { environment: 'local', tone: 'success' } },
    })
  })
})
