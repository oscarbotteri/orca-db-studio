// The panel against a stand-in worker: what the person sees and which requests it makes.
import { hostError, mockHost, mount } from 'orca/testing'
import { describe, expect, test } from 'vitest'
import * as panel from '../../src/panel/index'
import { CHOOSER_REQUEST_KEY, type ConnectionEntry, type SchemaTree } from '../../src/protocol'

const SHOP: ConnectionEntry = { ref: '/data/shop.db', name: 'shop.db', detail: 'data' }

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

describe('SQLite files group', () => {
  test('offers to open a file when there are none', async () => {
    const p = await mount(panel, {
      host: mockHost({ requests: { 'connections.list': { sqliteFiles: [], servers: [] } } }),
    })

    expect(p.find({ label: 'No SQLite files' })).not.toBeNull()
  })

  test('expanding a connection shows its schemas, tables and views', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [SHOP], servers: [] },
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
})

describe('removing a SQLite file', () => {
  test('Remove on a file row forgets it, collapses its tree and drops it from the list', async () => {
    let files = [SHOP]
    const host = mockHost({
      requests: {
        'connections.list': () => ({ sqliteFiles: files, servers: [] }),
        'explorer.listObjects': SHOP_TREE,
        'sqlite.remove': (input: { path: string }) => {
          files = files.filter((f) => f.ref !== input.path)
          return {}
        },
      },
    })
    const p = await mount(panel, { host })
    const key = JSON.stringify(['connection', SHOP.ref])
    await p.expand({ role: 'tree' }, key)

    await p.activateItem({ role: 'tree' }, key)
    await p.press({ text: 'Remove' })

    expect(host.callsOf('plugin.request')).toContainEqual({
      name: 'sqlite.remove',
      input: { path: SHOP.ref },
    })
    expect(p.find({ label: 'No SQLite files' })).not.toBeNull()
    expect(p.find({ text: 'Remove' })).toBeNull()
  })

  test('Cancel leaves the file in the list', async () => {
    const host = mockHost({
      requests: { 'connections.list': { sqliteFiles: [SHOP], servers: [] } },
    })
    const p = await mount(panel, { host })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))
    await p.press({ text: 'Cancel' })

    expect(host.callsOf('plugin.request')).not.toContainEqual(
      expect.objectContaining({ name: 'sqlite.remove' }),
    )
    expect(p.find({ text: 'Remove' })).toBeNull()
  })

  test('shows why a removal failed', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [SHOP], servers: [] },
        'sqlite.remove': () => {
          throw hostError('action_failed', 'No connection /data/shop.db')
        },
      },
    })
    const p = await mount(panel, { host })

    await p.activateItem({ role: 'tree' }, JSON.stringify(['connection', SHOP.ref]))
    await p.press({ text: 'Remove' })

    expect(p.find({ text: /No connection \/data\/shop.db/ })).not.toBeNull()
  })
})

describe('SQLite file chooser', () => {
  test('adds a file found in the workspaces and closes', async () => {
    let added: string | undefined
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [], servers: [] },
        'sqlite.findFiles': FOUND,
        'sqlite.add': ({ path }) => {
          added = path
          return { ref: path, name: 'app.db', detail: 'api' }
        },
      },
    })
    const p = await mount(panel, { host })

    await p.press({ label: 'Open SQLite file' })
    await p.press({ label: 'app.db' })

    expect(added).toBe('/work/api/app.db')
    expect(p.find({ label: 'Absolute path' })).toBeNull()
  })

  test('shows why a pasted path could not be added', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [], servers: [] },
        'sqlite.findFiles': { files: [] },
        'sqlite.add': () => {
          throw hostError('action_failed', '/tmp/notes.txt is not a SQLite database')
        },
      },
    })
    const p = await mount(panel, { host })

    await p.press({ label: 'Open SQLite file' })
    await p.type({ label: 'Absolute path' }, '/tmp/notes.txt', { submit: true })

    expect(p.find({ text: /is not a SQLite database/ })).not.toBeNull()
    expect(p.find({ label: 'Absolute path' })).not.toBeNull()
  })

  test('opens when the Open SQLite File command asked for it', async () => {
    const host = mockHost({
      storage: { [CHOOSER_REQUEST_KEY]: true },
      requests: { 'connections.list': { sqliteFiles: [], servers: [] }, 'sqlite.findFiles': FOUND },
    })
    const p = await mount(panel, { host })

    expect(p.find({ label: 'Absolute path' })).not.toBeNull()
    expect(p.find({ label: 'app.db' })).not.toBeNull()

    await p.press({ text: 'Cancel' })

    expect(p.find({ label: 'Absolute path' })).toBeNull()
    expect(host.data().storage[CHOOSER_REQUEST_KEY]).toBe(false)
  })

  test('opens with the found files when the command runs while the panel is open', async () => {
    const host = mockHost({
      requests: { 'connections.list': { sqliteFiles: [], servers: [] }, 'sqlite.findFiles': FOUND },
    })
    const p = await mount(panel, { host })

    await p.post('sqlite.chooserRequested', {})

    expect(p.find({ label: 'app.db' })).not.toBeNull()
  })
})

describe('opening a table', () => {
  const tree = { role: 'tree' }
  const connectionKey = JSON.stringify(['connection', SHOP.ref])
  const ordersKey = JSON.stringify(['object', SHOP.ref, 'main', 'orders'])

  async function mountShop(open: (input: unknown) => unknown) {
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [SHOP], servers: [] },
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
  const PG = { ref: 'c1', name: 'Shop DB', detail: 'app@db.internal:5432/shop' }
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
        'connections.list': { sqliteFiles: [], servers: [PG] },
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
