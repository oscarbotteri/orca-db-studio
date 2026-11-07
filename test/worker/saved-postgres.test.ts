// A saved PostgreSQL connection end to end: the worker's requests against a real server (needs Docker).

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { mockHost, mountWorker } from 'orca/testing'
import { afterAll, beforeAll, expect, test } from 'vitest'
import * as worker from '../../src/worker/index'

let container: StartedPostgreSqlContainer
let root: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:latest').start()
  root = await mkdtemp(join(tmpdir(), 'db-studio-pg-'))
  await mkdir(join(root, 'api'))
}, 120_000)

afterAll(async () => {
  await container?.stop()
  await rm(root, { recursive: true, force: true })
})

test('tests, saves, browses and opens a table on a PostgreSQL connection', async () => {
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'w1',
            kind: 'worktree',
            name: 'api',
            path: join(root, 'api'),
            branch: 'main',
            hostId: 'local',
          },
        ],
        truncated: false,
      },
      'editor.open': { opened: true },
    },
  })
  const w = await mountWorker(worker, { host })
  const form = {
    name: 'Container',
    engine: 'postgres' as const,
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
  }
  const password = container.getPassword()

  await w.request('connection.test', { form, password })
  const { ref } = await w.request('connection.save', { form, password })
  const tree = await w.request('explorer.listObjects', { ref })
  expect(tree.schemas.map((s) => s.name)).toContain('public')

  const wrong = { form, password: 'not-the-password' }
  await expect(w.request('connection.test', wrong)).rejects.toThrow(
    /password authentication failed/,
  )

  const opened = await w.request('table.open', {
    ref,
    schema: 'public',
    table: 'things',
    workspaceId: 'w1',
  })
  expect(opened.status).toBe('opened')
  if (opened.status === 'opened') {
    expect(await readFile(join(root, 'api', opened.path), 'utf8')).toContain(
      `connection=${ref}\nSELECT * FROM "public"."things"`,
    )
  }
  await w.deactivate()
}, 120_000)
