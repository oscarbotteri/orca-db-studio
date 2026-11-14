// Neon: the projects an API key can reach, through the console API.
import type { CloudBranch, CloudDatabase, CloudProject } from '../../protocol'

const BASE = 'https://console.neon.tech/api/v2'

interface NeonProject {
  id?: string
  name?: string
  region_id?: string
  pg_version?: number
  org_id?: string
  created_at?: string
  updated_at?: string
}

interface NeonProjects {
  projects?: NeonProject[]
  /** The cursor of the next page; the API answers ten projects unless `limit` says otherwise. */
  pagination?: { cursor?: string }
}

/** Neon pages its projects, so a big account needs a few calls; this is the most it will do. */
const PAGE_LIMIT = 100
const MAX_PAGES = 20

async function get<T>(key: string, path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`Could not reach Neon: ${(error as Error).message}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Neon refused the API key (401). Check that it belongs to your organization.')
  }
  if (!response.ok) throw new Error(`Neon answered ${response.status}`)
  return (await response.json()) as T
}

/** Every project one key reaches, following the API's cursor to the last page. */
async function projectsOf(key: string): Promise<NeonProject[]> {
  const byId = new Map<string, NeonProject>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set('cursor', cursor)
    const body = await get<NeonProjects>(key, `/projects?${query.toString()}`)
    const batch = body.projects ?? []
    for (const project of batch) if (project.id) byId.set(project.id, project)
    const next = body.pagination?.cursor
    // The last page repeats its cursor, and an empty page means there is nothing after it.
    if (batch.length === 0 || !next || next === cursor) break
    cursor = next
  }
  return [...byId.values()]
}

/** Every project the keys reach, once each: two keys of one org list the same project. */
export async function listProjects(keys: string[]): Promise<CloudProject[]> {
  const byId = new Map<string, CloudProject>()
  for (const key of keys) {
    for (const project of await projectsOf(key)) {
      if (!project.id || byId.has(project.id)) continue
      byId.set(project.id, {
        id: project.id,
        name: project.name ?? project.id,
        detail: [project.region_id, project.pg_version ? `PG ${project.pg_version}` : undefined]
          .filter(Boolean)
          .join(' · '),
        ...(project.created_at ? { createdAt: project.created_at } : {}),
      })
    }
  }
  // Newest first: a fresh project is the one being looked for; the name only breaks ties.
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1
    }
    return a.name.localeCompare(b.name, undefined)
  })
}

interface NeonBranch {
  id?: string
  name?: string
  default?: boolean
  primary?: boolean
  current_state?: string
  created_at?: string
}

interface NeonDatabase {
  name?: string
  owner_name?: string
}

async function firstKeyThatAnswers<T>(
  keys: string[],
  read: (key: string) => Promise<T>,
): Promise<T> {
  let last: Error | undefined
  for (const key of keys) {
    try {
      return await read(key)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw last ?? new Error('No Neon API key is stored')
}

/** Where a branch stands, in one line: its state, its age, and whether it is the primary one. */
function branchDetail(branch: NeonBranch): string {
  const state = branch.current_state ?? ''
  const created = branch.created_at ? branch.created_at.slice(0, 10) : ''
  return [state, created, branch.primary ? 'primaria' : undefined]
    .filter((part): part is string => !!part)
    .join(' · ')
}

/** The databases one branch holds: in Neon a branch is what owns them. */
async function databasesOfBranch(
  key: string,
  projectId: string,
  branch: NeonBranch,
): Promise<CloudDatabase[]> {
  if (!branch.id) return []
  const { databases = [] } = await get<{ databases?: NeonDatabase[] }>(
    key,
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branch.id)}/databases`,
  )
  return databases
    .filter((database) => database.name)
    .map((database) => ({
      name: database.name ?? '',
      role: database.owner_name ?? 'neondb_owner',
      ...(branch.name ? { branch: branch.name } : {}),
      ...(branch.id ? { branchId: branch.id } : {}),
    }))
}

/**
 * Every branch of a project with the databases it holds. Neon keeps a whole copy of the data per
 * branch, so the same database name shows up on each of them and each opens its own connection.
 */
export async function listBranches(keys: string[], projectId: string): Promise<CloudBranch[]> {
  return firstKeyThatAnswers(keys, async (key) => {
    const { branches = [] } = await get<{ branches?: NeonBranch[] }>(
      key,
      `/projects/${encodeURIComponent(projectId)}/branches`,
    )
    const ordered = [...branches].sort((a, b) => {
      if (Boolean(a.default) !== Boolean(b.default)) return a.default ? -1 : 1
      return (a.name ?? '').localeCompare(b.name ?? '', undefined)
    })
    const out: CloudBranch[] = []
    for (const branch of ordered) {
      if (!branch.id) continue
      out.push({
        id: branch.id,
        name: branch.name ?? branch.id,
        isDefault: branch.default === true,
        detail: branchDetail(branch),
        databases: await databasesOfBranch(key, projectId, branch),
      })
    }
    return out
  })
}

/** The full connection string of one database, password included: the API hands it over. */
export async function connectionUri(
  keys: string[],
  projectId: string,
  database: CloudDatabase,
  branchId?: string,
): Promise<string> {
  return firstKeyThatAnswers(keys, async (key) => {
    const query = new URLSearchParams({ database_name: database.name, role_name: database.role })
    if (branchId) query.set('branch_id', branchId)
    const { uri } = await get<{ uri?: string }>(
      key,
      `/projects/${encodeURIComponent(projectId)}/connection_uri?${query.toString()}`,
    )
    if (!uri) throw new Error('Neon returned no connection string for that database')
    return uri
  })
}

interface NeonUser {
  email?: string
  name?: string
}

interface NeonOrganizations {
  organizations?: { id?: string; name?: string }[]
}

/**
 * How the selector names the account a token belongs to: its email when the key is personal, the
 * organization's name when it is an organization key (those cannot read `/users/me`).
 */
export async function accountLabel(key: string): Promise<string> {
  const user = await get<NeonUser>(key, '/users/me').catch(() => undefined)
  if (user?.email) return user.email
  const { organizations = [] } = await get<NeonOrganizations>(key, '/users/me/organizations')
  const names = organizations.map((org) => org.name).filter((name): name is string => !!name)
  const [first = '', ...rest] = names
  if (!first) throw new Error('Neon did not say which account the key belongs to')
  return rest.length === 0 ? first : `${first} +${rest.length}`
}
