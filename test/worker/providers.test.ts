// Seam B: the hosted providers' keys and the projects they reach, with the network stubbed.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockHost, mountWorker } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Provider } from '../../src/protocol'
import { resolveCloud } from '../../src/worker/cloud-connections'
import * as worker from '../../src/worker/index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'db-studio-provider-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

interface Answer {
  status?: number
  body: unknown
}

/**
 * A stand-in for fetch: each path answers with the body listed for it, and `byToken` can answer
 * differently per key, which is what tells two accounts apart.
 */
function stubNetwork(
  routes: Record<string, Answer>,
  byToken: Record<string, Record<string, Answer>> = {},
) {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(input))
    const key = url.pathname + (url.search || '')
    seen.push(key)
    const token = String(init?.headers?.Authorization ?? '').replace('Bearer ', '')
    const table = { ...routes, ...(byToken[token] ?? {}) }
    // A route may be keyed by pathname alone, or by pathname and query for the ones that matter.
    const answer = table[key] ?? table[url.pathname] ?? { status: 404, body: {} }
    const status = answer.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body,
    }
  })
  return seen
}

const NEON_PROJECTS = {
  body: {
    projects: [
      { id: 'p1', name: 'shop', region_id: 'aws-eu-central-1', pg_version: 17 },
      { id: 'p2', name: 'analytics', region_id: 'aws-us-east-1', pg_version: 16 },
    ],
  },
}

async function start() {
  const host = mockHost()
  const w = await mountWorker(worker, { host })
  return { host, w }
}

async function envFile(name: string, contents: string): Promise<string> {
  const path = join(root, name)
  await writeFile(path, contents)
  return path
}

function addKey(w: Awaited<ReturnType<typeof start>>['w'], provider: Provider, value: string) {
  return w.request('provider.addKey', { provider, value })
}

describe('provider keys', () => {
  test('stores the token written in a .env file it is given by path', async () => {
    const seen = stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { host, w } = await start()
    const path = await envFile(
      '.env',
      'DATABASE_URL=postgres://x\nNEON_API_KEY=napi_abc123def456\n',
    )

    const view = await addKey(w, 'neon', path)

    expect(view.keys).toHaveLength(1)
    expect(view.keys[0]).toMatchObject({ masked: 'napi_ab…f456' })
    expect(view.projects.map((p) => p.name)).toEqual(['analytics', 'shop'])
    expect(view.projects[0]?.detail).toBe('aws-us-east-1 · PG 16')
    expect(seen.filter((path) => path.startsWith('/api/v2/projects'))).toEqual([
      '/api/v2/projects?limit=100',
    ])
    // The token lives in secrets, never in the storage a settings backup would copy.
    expect(JSON.stringify(host.data().storage)).not.toContain('napi_abc123def456')
    expect(JSON.stringify(host.data().secrets)).toContain('napi_abc123def456')
    await w.deactivate()
  })

  test('accepts the token pasted straight into the field', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_pastedtoken1234')

    expect(view.keys).toHaveLength(1)
    expect(view.projects).toHaveLength(2)
    await w.deactivate()
  })

  test('refuses a file that holds no token for that provider', async () => {
    stubNetwork({})
    const { w } = await start()
    const path = await envFile('.env', 'DATABASE_URL=postgres://x\n')

    await expect(addKey(w, 'neon', path)).rejects.toThrow(/holds no neon token/)
    await w.deactivate()
  })

  test('refuses a path that cannot be read', async () => {
    stubNetwork({})
    const { w } = await start()

    await expect(addKey(w, 'supabase', join(root, 'nope.env'))).rejects.toThrow(/Could not read/)
    await w.deactivate()
  })

  test('a refused key is kept out of the list but the stored one stays, with why', async () => {
    stubNetwork({ '/api/v2/projects': { status: 401, body: {} } })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')

    const view = await w.request('provider.view', { provider: 'neon' })

    expect(view.keys).toHaveLength(1)
    expect(view.projects).toEqual([])
    expect(view.error).toMatch(/refused the API key/)
    await w.deactivate()
  })

  test('two keys reaching the same project list it once', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_first123456789')

    const view = await addKey(w, 'neon', 'napi_second12345678')

    expect(view.keys).toHaveLength(2)
    expect(view.projects.map((p) => p.id)).toEqual(['p2', 'p1'])
    await w.deactivate()
  })

  test('removing the keys leaves the provider empty', async () => {
    stubNetwork({ '/api/v2/projects': NEON_PROJECTS })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')

    const view = await w.request('provider.clearKeys', { provider: 'neon' })

    expect(view).toEqual({ keys: [], projects: [] })
    await w.deactivate()
  })

  test('supabase lists its projects with the token', async () => {
    const seen = stubNetwork({
      '/v1/organizations': { body: [{ name: 'acme' }] },
      '/v1/projects': {
        body: [
          { ref: 'abc', name: 'pioneros', region: 'eu-central-1', status: 'ACTIVE_HEALTHY' },
          { ref: 'def', name: 'sonicflow', region: 'eu-west-1', status: 'PAUSED' },
        ],
      },
    })
    const { w } = await start()

    const view = await addKey(w, 'supabase', 'sbp_token123456789')

    expect(view.projects).toEqual([
      { id: 'abc', name: 'pioneros', detail: 'eu-central-1 · active_healthy' },
      { id: 'def', name: 'sonicflow', detail: 'eu-west-1 · paused' },
    ])
    expect(view.keys[0]?.label).toBe('acme')
    expect(seen.filter((path) => path.startsWith('/v1/projects'))).toEqual(['/v1/projects'])
    await w.deactivate()
  })

  test('a provider without keys asks for nothing over the network', async () => {
    const seen = stubNetwork({})
    const { w } = await start()

    const view = await w.request('provider.view', { provider: 'neon' })

    expect(view).toEqual({ keys: [], projects: [] })
    expect(seen).toEqual([])
    await w.deactivate()
  })
})

const NEON_BRANCHES = { body: { branches: [{ id: 'br-1', name: 'main', default: true }] } }
const NEON_DATABASES = { body: { databases: [{ name: 'neondb', owner_name: 'neondb_owner' }] } }
const NEON_URI = {
  body: {
    uri: 'postgresql://neondb_owner:s3cretpw@ep-cool-rain-pooler.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require',
  },
}

describe('neon databases', () => {
  async function withKey(routes: Record<string, Answer>) {
    const seen = stubNetwork(routes)
    const { host, w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')
    return { host, w, seen }
  }

  test('lists every branch of a project with the databases it holds', async () => {
    const { w } = await withKey({
      '/api/v2/projects': NEON_PROJECTS,
      '/api/v2/projects/p1/branches': {
        body: {
          branches: [
            { id: 'br-2', name: 'development', default: false, current_state: 'active' },
            {
              id: 'br-1',
              name: 'main',
              default: true,
              primary: true,
              current_state: 'active',
              created_at: '2026-01-02T03:04:05Z',
            },
          ],
        },
      },
      '/api/v2/projects/p1/branches/br-1/databases': NEON_DATABASES,
      '/api/v2/projects/p1/branches/br-2/databases': {
        body: { databases: [{ name: 'neondb', owner_name: 'neondb_owner' }] },
      },
    })

    const { branches } = await w.request('provider.databases', {
      provider: 'neon',
      projectId: 'p1',
    })

    // The default branch comes first, whatever order the API answered in.
    expect(branches.map((b) => [b.name, b.isDefault])).toEqual([
      ['main', true],
      ['development', false],
    ])
    expect(branches[0]?.detail).toBe('active · 2026-01-02 · primaria')
    expect(branches[0]?.databases).toEqual([
      { name: 'neondb', role: 'neondb_owner', branch: 'main', branchId: 'br-1' },
    ])
    expect(branches[1]?.databases[0]).toMatchObject({ branchId: 'br-2' })
    await w.deactivate()
  })

  test('opening a database stores its string in secrets and lists it as a connection', async () => {
    const { host, w } = await withKey({
      '/api/v2/projects': NEON_PROJECTS,
      '/api/v2/projects/p1/branches': NEON_BRANCHES,
      '/api/v2/projects/p1/branches/br-1/databases': NEON_DATABASES,
      '/api/v2/projects/p1/connection_uri?database_name=neondb&role_name=neondb_owner&branch_id=br-1':
        NEON_URI,
    })

    const entry = await w.request('provider.connect', {
      provider: 'neon',
      projectId: 'p1',
      database: 'neondb',
    })

    // The default branch is used and named in the connection, so two branches never collide.
    expect(entry).toEqual({
      ref: 'cloud:neon:p1:br-1:neondb',
      name: 'shop · neondb',
      detail: 'ep-cool-rain-pooler.eu-central-1.aws.neon.tech/neondb',
      origin: 'cloud',
    })
    const { cloud } = await w.request('connections.list')
    expect(cloud).toHaveLength(1)
    // The password travels in the string, which lives in secrets only.
    expect(JSON.stringify(host.data().storage)).not.toContain('s3cretpw')
    expect(JSON.stringify(host.data().secrets)).toContain('s3cretpw')
    await w.deactivate()
  })

  test('supabase cannot be opened yet, and says why', async () => {
    stubNetwork({ '/v1/organizations': { body: [{ name: 'acme' }] } })
    const { w } = await start()
    await addKey(w, 'supabase', 'sbp_token123456789')

    await expect(
      w.request('provider.connect', {
        provider: 'supabase',
        projectId: 'abc',
        database: 'postgres',
      }),
    ).rejects.toThrow(/database password/)
    await w.deactivate()
  })
})

describe('neon pagination', () => {
  test('follows the cursor until the last page, so a big account is fully listed', async () => {
    const seen = stubNetwork({
      '/api/v2/users/me/organizations': { body: { organizations: [{ name: 'org' }] } },
      '/api/v2/projects?limit=100': {
        body: {
          projects: [{ id: 'p1', name: 'uno', region_id: 'r', pg_version: 17 }],
          pagination: { cursor: 'next-page' },
        },
      },
      '/api/v2/projects?limit=100&cursor=next-page': {
        body: {
          projects: [
            { id: 'p2', name: 'dos', region_id: 'r', pg_version: 17 },
            { id: 'p1', name: 'uno', region_id: 'r', pg_version: 17 },
          ],
          pagination: { cursor: 'next-page' },
        },
      },
    })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_abc123def456')

    expect(view.projects.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(seen.filter((path) => path.startsWith('/api/v2/projects'))).toEqual([
      '/api/v2/projects?limit=100',
      '/api/v2/projects?limit=100&cursor=next-page',
    ])
    await w.deactivate()
  })
})

describe('more than one account', () => {
  const SECOND_ORG = { body: { projects: [{ id: 'p9', name: 'otra-org', region_id: 'r' }] } }
  const ORGANIZATIONS = { body: { organizations: [{ name: 'acme-projects' }] } }

  test('labels the account with the email the API names', async () => {
    stubNetwork({
      '/api/v2/users/me': { body: { email: 'dev@example.com' } },
      '/api/v2/users/me/organizations': ORGANIZATIONS,
      '/api/v2/projects': NEON_PROJECTS,
    })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_abc123def456')

    expect(view.keys[0]?.label).toBe('dev@example.com')
    await w.deactivate()
  })

  test('falls back to the organization name for an organization key', async () => {
    stubNetwork({
      '/api/v2/users/me': {
        status: 404,
        body: { message: 'not allowed for organization API keys' },
      },
      '/api/v2/users/me/organizations': ORGANIZATIONS,
      '/api/v2/projects': NEON_PROJECTS,
    })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_abc123def456')

    expect(view.keys[0]?.label).toBe('acme-projects')
    await w.deactivate()
  })

  test('lists only the account the selector picked, and lands on the one just added', async () => {
    const FIRST = 'napi_abc123def456'
    const SECOND = 'napi_second12345678'
    stubNetwork(
      { '/api/v2/users/me/organizations': ORGANIZATIONS },
      {
        [FIRST]: { '/api/v2/projects': NEON_PROJECTS },
        [SECOND]: { '/api/v2/projects': SECOND_ORG },
      },
    )
    const { w } = await start()
    const first = await addKey(w, 'neon', FIRST)
    const firstId = first.keys[0]?.id ?? ''

    const both = await addKey(w, 'neon', SECOND)

    expect(both.keys).toHaveLength(2)
    expect(both.selected).toBe(both.keys[1]?.id)
    expect(both.projects.map((p) => p.name)).toEqual(['otra-org'])

    const back = await w.request('provider.view', { provider: 'neon', keyId: firstId })

    expect(back.selected).toBe(firstId)
    expect(back.projects.map((p) => p.name)).toEqual(['analytics', 'shop'])
    await w.deactivate()
  })

  test('removing one account leaves the others', async () => {
    stubNetwork({
      '/api/v2/users/me/organizations': ORGANIZATIONS,
      '/api/v2/projects': NEON_PROJECTS,
    })
    const { w } = await start()
    await addKey(w, 'neon', 'napi_abc123def456')
    const both = await addKey(w, 'neon', 'napi_second12345678')
    const keep = both.keys[0]?.id ?? ''
    const drop = both.keys[1]?.id ?? ''

    const after = await w.request('provider.clearKeys', { provider: 'neon', keyId: drop })

    expect(after.keys.map((k) => k.id)).toEqual([keep])
    await w.deactivate()
  })
})

describe('a stored cloud connection', () => {
  const orca = {
    secrets: {
      get: async () =>
        'postgresql://neondb_owner:pw@ep-cool-rain.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    },
  } as unknown as OrcaWorkerApi

  test('is parsed back into a config that keeps its sslmode and its password', async () => {
    const cloud = await resolveCloud(orca, 'cloud:neon:p1:neondb')

    expect(cloud.config).toEqual({
      engine: 'postgres',
      host: 'ep-cool-rain.eu-central-1.aws.neon.tech',
      port: 5432,
      database: 'neondb',
      user: 'neondb_owner',
      ssl: 'require',
    })
    expect(cloud.password).toBe('pw')
  })

  test('says so when the connection is no longer stored', async () => {
    const empty = { secrets: { get: async () => null } } as unknown as OrcaWorkerApi

    await expect(resolveCloud(empty, 'cloud:neon:p1:neondb')).rejects.toThrow(/no longer stored/)
  })
})

describe('project order', () => {
  test('lists the newest project first, whatever order the API answers in', async () => {
    stubNetwork({
      '/api/v2/users/me/organizations': { body: { organizations: [{ name: 'org' }] } },
      '/api/v2/projects': {
        body: {
          projects: [
            { id: 'p-old', name: 'old', region_id: 'r', created_at: '2026-01-02T00:00:00Z' },
            { id: 'p-new', name: 'new', region_id: 'r', created_at: '2026-11-12T00:00:00Z' },
            { id: 'p-mid', name: 'middle', region_id: 'r', created_at: '2026-06-01T00:00:00Z' },
          ],
        },
      },
    })
    const { w } = await start()

    const view = await addKey(w, 'neon', 'napi_abc123def456')

    expect(view.projects.map((p) => p.name)).toEqual(['new', 'middle', 'old'])
    expect(view.projects[0]?.createdAt).toBe('2026-11-12T00:00:00Z')
    await w.deactivate()
  })
})
