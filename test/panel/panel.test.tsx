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
      host: mockHost({ requests: { 'connections.list': { sqliteFiles: [] } } }),
    })

    expect(p.find({ label: 'No SQLite files' })).not.toBeNull()
  })

  test('expanding a connection shows its schemas, tables and views', async () => {
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [SHOP] },
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

describe('SQLite file chooser', () => {
  test('adds a file found in the workspaces and closes', async () => {
    let added: string | undefined
    const host = mockHost({
      requests: {
        'connections.list': { sqliteFiles: [] },
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
        'connections.list': { sqliteFiles: [] },
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
      requests: { 'connections.list': { sqliteFiles: [] }, 'sqlite.findFiles': FOUND },
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
      requests: { 'connections.list': { sqliteFiles: [] }, 'sqlite.findFiles': FOUND },
    })
    const p = await mount(panel, { host })

    await p.post('sqlite.chooserRequested', {})

    expect(p.find({ label: 'app.db' })).not.toBeNull()
  })
})
