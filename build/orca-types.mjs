// Writes .orca/types the way `orca plugin types` does, from the pinned stablyai/orca commit.
// The packaged Orca app does not ship these typings, and CI has no Orca installed.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ORCA_REF = '894dbbd0eccf40a566728d3da01f7f26fe3d44fd'
const RAW = `https://raw.githubusercontent.com/stablyai/orca/${ORCA_REF}/resources/plugins`
const TYPES_DIR = join(import.meta.dirname, '..', '.orca', 'types')
const NOTE = '// Fetched by build/orca-types.mjs from stablyai/orca. Do not edit.\n'

const ORCA_MODULE = [
  'orca.d.ts',
  'orca-components.d.ts',
  'orca-components-layout.d.ts',
  'orca-components-data.d.ts',
]
const SURFACES = ['orca-host', 'orca-frame', 'orca-worker', 'orca-services', 'orca-testing']

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    allowImportingTsExtensions: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    jsxImportSource: 'orca',
    lib: ['ES2022', 'DOM'],
    preserveSymlinks: true,
    typeRoots: ['.'],
    types: ['orca', ...SURFACES],
  },
}

async function download(path) {
  const response = await fetch(`${RAW}/${path}`)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.text()
}

async function writeTyping(folder, text) {
  await mkdir(join(TYPES_DIR, folder), { recursive: true })
  await writeFile(join(TYPES_DIR, folder, 'index.d.ts'), NOTE + text)
}

const orcaModule = await Promise.all(ORCA_MODULE.map((file) => download(`declarative/${file}`)))
await writeTyping('orca', orcaModule.join('\n'))
for (const surface of SURFACES) {
  await writeTyping(surface, await download(`types/${surface}.d.ts`))
}
await writeFile(join(TYPES_DIR, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`)
