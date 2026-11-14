// Supabase: the projects a personal access token can reach, through the Management API.
import type { CloudProject } from '../../protocol'

const BASE = 'https://api.supabase.com/v1'

interface SupabaseProject {
  ref?: string
  id?: string
  name?: string
  region?: string
  status?: string
  created_at?: string
  database?: { version?: string }
}

async function get<T>(token: string, path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`Could not reach Supabase: ${(error as Error).message}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Supabase refused the token (401). Check that it is a personal access token.')
  }
  if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
  return (await response.json()) as T
}

/** Every project the token reaches, once each. */
export async function listProjects(tokens: string[]): Promise<CloudProject[]> {
  const byRef = new Map<string, CloudProject>()
  for (const token of tokens) {
    const projects = await get<SupabaseProject[]>(token, '/projects')
    for (const project of projects) {
      const ref = project.ref ?? project.id
      if (!ref || byRef.has(ref)) continue
      byRef.set(ref, {
        id: ref,
        name: project.name ?? ref,
        detail: [project.region, project.status?.toLowerCase(), project.database?.version]
          .filter(Boolean)
          .join(' · '),
        ...(project.created_at ? { createdAt: project.created_at } : {}),
      })
    }
  }
  // Newest first, like Neon: the project just created is the one being looked for.
  return [...byRef.values()].sort((a, b) => {
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1
    }
    return a.name.localeCompare(b.name, undefined)
  })
}

interface SupabaseOrganization {
  name?: string
  slug?: string
}

/**
 * How the selector names the account a token belongs to. The Management API lists the token's
 * organizations and no profile, so the first organization stands for the account.
 */
export async function accountLabel(token: string): Promise<string> {
  const organizations = await get<SupabaseOrganization[]>(token, '/organizations')
  const names = organizations.map((org) => org.name ?? org.slug).filter((n): n is string => !!n)
  const [first = '', ...rest] = names
  if (!first) throw new Error('Supabase did not say which account the token belongs to')
  return rest.length === 0 ? first : `${first} +${rest.length}`
}
