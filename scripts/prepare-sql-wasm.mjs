import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const source = require.resolve('sql.js/dist/sql-wasm.wasm')
const publicDirectory = new URL('../public/', import.meta.url)
const destination = new URL('sql-wasm.wasm', publicDirectory)

await mkdir(publicDirectory, { recursive: true })
await copyFile(source, destination)
console.log('Prepared local SQLite WebAssembly asset.')
