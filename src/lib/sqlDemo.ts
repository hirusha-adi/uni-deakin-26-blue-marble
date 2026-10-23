import type { SqlJsStatic } from 'sql.js'

export type SqlMode = 'vulnerable' | 'protected'

export interface DemoUser {
  username: string
  displayName: string
  role: string
}

export interface SqlLoginResult {
  status: 'success' | 'rejected' | 'error'
  query: string
  parameters?: string[]
  user?: DemoUser
  error?: string
}

export const SQL_ATTACK_USERNAME = "admin' --"
export const SQL_ATTACK_PAYLOADS = [
  { username: SQL_ATTACK_USERNAME, password: 'anything' },
  { username: "missing' OR 1=1 --", password: 'anything' },
  { username: "missing' OR 'a'='a' --", password: 'anything' },
  { username: "student' --", password: 'anything' },
  { username: 'student', password: "' OR 1=1 --" },
] as const
export const SQL_DEMO_USERNAME = 'student'
export const SQL_DEMO_PASSWORD = 'marble2026'
export const SQL_INPUT_MAX_LENGTH = 250

export function buildLoginQuery(username: string, password: string, mode: SqlMode): string {
  const selection = 'SELECT username, display_name, role FROM users'
  return mode === 'protected'
    ? `${selection}\nWHERE username = ? AND password = ?\nLIMIT 1;`
    : `${selection}\nWHERE username = '${username}' AND password = '${password}'\nLIMIT 1;`
}

/** A fresh, temporary SQLite database is created and destroyed for each attempt. */
export function runSqlLogin(SQL: SqlJsStatic, username: string, password: string, mode: SqlMode): SqlLoginResult {
  const boundedUsername = username.slice(0, SQL_INPUT_MAX_LENGTH)
  const boundedPassword = password.slice(0, SQL_INPUT_MAX_LENGTH)
  const query = buildLoginQuery(boundedUsername, boundedPassword, mode)
  const parameters = mode === 'protected' ? [boundedUsername, boundedPassword] : undefined
  const database = new SQL.Database()
  try {
    database.run(`
      CREATE TABLE users (username TEXT PRIMARY KEY, password TEXT, display_name TEXT, role TEXT);
      INSERT INTO users VALUES ('admin', 'toy-admin-password', 'Alex Admin', 'Administrator');
      INSERT INTO users VALUES ('student', 'marble2026', 'Sam Student', 'Student');
      INSERT INTO users VALUES ('guide', 'blueplanet', 'Taylor Guide', 'Tour guide');
    `)
    const statement = database.prepare(query)
    try {
      if (parameters) statement.bind(parameters)
      if (!statement.step()) return { status: 'rejected', query, parameters }
      const row = statement.getAsObject()
      return {
        status: 'success',
        query,
        parameters,
        user: {
          username: String(row.username),
          displayName: String(row.display_name),
          role: String(row.role),
        },
      }
    } finally {
      statement.free()
    }
  } catch (error) {
    return { status: 'error', query, parameters, error: error instanceof Error ? error.message : 'The query could not run.' }
  } finally {
    database.close()
  }
}
