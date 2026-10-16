import type { SqlJsStatic } from 'sql.js'

let enginePromise: Promise<SqlJsStatic> | undefined

export function loadSqlEngine(): Promise<SqlJsStatic> {
  if (!enginePromise) {
    enginePromise = import('sql.js/dist/sql-wasm-browser.js').then(({ default: initSqlJs }) => initSqlJs({ locateFile: () => '/sql-wasm.wasm' })).catch((error: unknown) => {
      enginePromise = undefined
      throw error
    })
  }
  return enginePromise
}
