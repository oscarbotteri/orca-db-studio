// Finds SQLite files in the person's local workspaces for the chooser. C3
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { FoundSqliteFile } from '../protocol'

const EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.db3'])
const SKIPPED_DIRS = new Set(['node_modules', '.git'])

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function walk(dir: string, found: string[]): Promise<void> {
  for (const entry of await entries(dir)) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walk(path, found)
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      found.push(path)
    }
  }
}

export async function findSqliteFiles(orca: OrcaWorkerApi): Promise<FoundSqliteFile[]> {
  const { workspaces } = await orca.host.call('workspace.list')
  const files: FoundSqliteFile[] = []
  // Remote workspaces live on another machine; their paths mean nothing here.
  for (const workspace of workspaces.filter((w) => w.hostId === null)) {
    const found: string[] = []
    await walk(workspace.path, found)
    for (const path of found.sort()) {
      files.push({
        path,
        relativePath: relative(workspace.path, path),
        workspaceName: workspace.name,
      })
    }
  }
  return files
}
