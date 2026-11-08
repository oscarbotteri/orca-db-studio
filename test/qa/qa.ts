// Starts, stops and resets the manual QA environment. Usage: node test/qa/qa.ts up|down|reset
// SQLite needs no service; PostgreSQL and MariaDB run from `compose.yaml`.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  run('docker', ['compose', '-f', compose, '--env-file', envFile, ...args])
}

/** Creates `.env` from the example on first use, with random passwords so none is ever committed. */
function ensureEnv(): void {
  if (existsSync(envFile)) return
  copyFileSync(join(here, '.env.example'), envFile)
  const filled = readFileSync(envFile, 'utf8').replace(
    /^((?:POSTGRES|MARIADB)_(?:ROOT_)?PASSWORD)=$/gm,
    (_, name: string) => `${name}=${randomBytes(12).toString('hex')}`,
  )
  writeFileSync(envFile, filled)
}

function seed(): void {
  run(process.execPath, [join(here, 'seed-sqlite.ts')])
  run(process.execPath, [join(here, 'seed-postgres.ts')])
  run(process.execPath, [join(here, 'seed-mariadb.ts')])
}

if (action === 'up') {
  ensureEnv()
  seed()
  services('up', '-d', '--wait')
} else if (action === 'down') {
  ensureEnv()
  services('down')
} else if (action === 'reset') {
  ensureEnv()
  services('down', '-v')
  seed()
  services('up', '-d', '--wait')
} else {
  process.stderr.write('Usage: qa.ts up|down|reset\n')
  process.exit(1)
}
