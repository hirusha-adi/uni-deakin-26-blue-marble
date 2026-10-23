import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { runSqlLogin, SQL_ATTACK_PAYLOADS, SQL_ATTACK_USERNAME, SQL_DEMO_PASSWORD, SQL_DEMO_USERNAME } from './sqlDemo'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => './node_modules/sql.js/dist/sql-wasm.wasm' })
})

describe('browser SQLite login demonstration', () => {
  it('authenticates the fictional student in both modes', () => {
    for (const mode of ['vulnerable', 'protected'] as const) {
      const result = runSqlLogin(SQL, SQL_DEMO_USERNAME, SQL_DEMO_PASSWORD, mode)
      expect(result.status).toBe('success')
      expect(result.user?.username).toBe('student')
    }
  })

  it('demonstrates an actual SQL bypass and its parameterized defense', () => {
    const vulnerable = runSqlLogin(SQL, SQL_ATTACK_USERNAME, 'wrong-password', 'vulnerable')
    expect(vulnerable.status).toBe('success')
    expect(vulnerable.user?.username).toBe('admin')
    const protectedResult = runSqlLogin(SQL, SQL_ATTACK_USERNAME, 'wrong-password', 'protected')
    expect(protectedResult.status).toBe('rejected')
    expect(protectedResult.parameters).toEqual([SQL_ATTACK_USERNAME, 'wrong-password'])
  })

  it.each(SQL_ATTACK_PAYLOADS)('bypasses vulnerable login with $username / $password but is rejected when protected', ({ username, password }) => {
    const vulnerable = runSqlLogin(SQL, username, password, 'vulnerable')
    expect(vulnerable.status).toBe('success')
    expect(vulnerable.user).toBeDefined()

    const protectedResult = runSqlLogin(SQL, username, password, 'protected')
    expect(protectedResult.status).toBe('rejected')
    expect(protectedResult.parameters).toEqual([username, password])
  })

  it('rejects incorrect passwords and reports malformed vulnerable queries', () => {
    expect(runSqlLogin(SQL, 'student', 'wrong-password', 'vulnerable').status).toBe('rejected')
    expect(runSqlLogin(SQL, "'", 'anything', 'vulnerable').status).toBe('error')
    expect(runSqlLogin(SQL, "'", 'anything', 'protected').status).toBe('rejected')
  })

  it('evaluates SQL logic rather than hard-coding recognition of the example payload', () => {
    const payload = "missing' OR 1=1 --"
    expect(runSqlLogin(SQL, payload, 'wrong-password', 'vulnerable').status).toBe('success')
    expect(runSqlLogin(SQL, payload, 'wrong-password', 'protected').status).toBe('rejected')
  })
})

