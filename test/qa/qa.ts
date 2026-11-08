// Starts, stops and resets the manual QA environment. Usage: node test/qa/qa.ts up|down|reset
// SQLite needs no service; the PostgreSQL service lives in `compose.yaml`, MariaDB joins it in its own ticket.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const compose = join(here, 'compose.yaml')
const envFile = join(here, '.env')
const action = process.argv[2]

function run(command: string, args: string[]): void {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status !== 0) process.exit(status ?? 1)
}

function services(...args: string[]): void {
  if (!existsSync(envFile)) {
    process.stderr.write(
      'Missing test/qa/.env: cp test/qa/.env.example test/qa/.env and set a password.\n',
    )
    process.exit(1)
  }
  run('docker', ['compose', '-f', compose, '--env-file', envFile, ...args])
}

function seedPostgres(): void {
  run(process.execPath, [join(here, 'seed-postgres.ts')])
}

function seedSqlite(): void {
  run(process.execPath, [join(here, 'seed-sqlite.ts')])
}

if (action === 'up') {
  seedPostgres()
  services('up', '-d', '--wait')
  seedSqlite()
} else if (action === 'down') {
  services('down')
} else if (action === 'reset') {
  services('down', '-v')
  seedPostgres()
  services('up', '-d', '--wait')
  seedSqlite()
} else {
  process.stderr.write('Usage: qa.ts up|down|reset\n')
  process.exit(1)
}
