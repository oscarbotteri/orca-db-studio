// Starts, stops and resets the manual QA environment. Usage: node test/qa/qa.ts up|down|reset
// SQLite needs no service; the PostgreSQL and MariaDB services join `compose.yaml` in their own tickets.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const compose = join(here, 'compose.yaml')
const action = process.argv[2]

function run(command: string, args: string[]): void {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status !== 0) process.exit(status ?? 1)
}

function services(...args: string[]): void {
  if (existsSync(compose)) run('docker', ['compose', '-f', compose, ...args])
  else process.stdout.write('No database services defined yet; nothing to start or stop.\n')
}

function seedSqlite(): void {
  run(process.execPath, [join(here, 'seed-sqlite.ts')])
}

if (action === 'up') {
  services('up', '-d', '--wait')
  seedSqlite()
} else if (action === 'down') {
  services('down')
} else if (action === 'reset') {
  services('down', '-v')
  services('up', '-d', '--wait')
  seedSqlite()
} else {
  process.stderr.write('Usage: qa.ts up|down|reset\n')
  process.exit(1)
}
