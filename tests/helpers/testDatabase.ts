/**
 * Test database adapter — mimics better-sqlite3 API using sql.js (WASM SQLite).
 *
 * better-sqlite3 can't run in Vitest (compiled for Electron's Node ABI),
 * so tests use sql.js which is pure WASM and works in any Node environment.
 *
 * This adapter translates better-sqlite3's prepare/run/get/all API to sql.js equivalents,
 * allowing BetterSQLiteService SQL queries to be tested against real SQLite.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { DATABASE_SCHEMA } from '../../src/main/database/schema'

interface RunResult {
  changes: number
  lastInsertRowid: number
}

interface PreparedStatement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

export interface TestDatabase {
  prepare(sql: string): PreparedStatement
  exec(sql: string): void
  pragma(str: string): unknown
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T
  close(): void
}

function rowsToObjects(columns: string[], values: unknown[][]): Record<string, unknown>[] {
  return values.map(row => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

function createAdapter(db: SqlJsDatabase): TestDatabase {
  return {
    prepare(sql: string): PreparedStatement {
      return {
        run(...params: unknown[]): RunResult {
          db.run(sql, params as (string | number | null | Uint8Array)[])
          // Get last insert rowid
          const idResult = db.exec('SELECT last_insert_rowid() as id')
          const lastId = idResult.length > 0 ? (idResult[0].values[0][0] as number) : 0
          return {
            changes: db.getRowsModified(),
            lastInsertRowid: lastId,
          }
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const stmt = db.prepare(sql)
          if (params.length > 0) {
            stmt.bind(params as (string | number | null | Uint8Array)[])
          }
          if (stmt.step()) {
            const columns = stmt.getColumnNames()
            const values = stmt.get()
            stmt.free()
            const obj: Record<string, unknown> = {}
            columns.forEach((col, i) => { obj[col] = values[i] })
            return obj
          }
          stmt.free()
          return undefined
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          const results = db.exec(sql, params as (string | number | null | Uint8Array)[])
          if (results.length === 0) return []
          return rowsToObjects(results[0].columns, results[0].values)
        },
      }
    },

    exec(sql: string): void {
      db.exec(sql)
    },

    pragma(str: string): unknown {
      // Handle common pragmas used in tests
      if (str.startsWith('integrity_check')) {
        return [{ integrity_check: 'ok' }]
      }
      if (str.startsWith('foreign_keys')) {
        db.run(`PRAGMA ${str}`)
        return
      }
      // Most pragmas are no-ops in test context
      return undefined
    },

    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return (...args: unknown[]) => {
        db.run('BEGIN TRANSACTION')
        try {
          const result = fn(...args)
          db.run('COMMIT')
          return result
        } catch (e) {
          db.run('ROLLBACK')
          throw e
        }
      }
    },

    close(): void {
      db.close()
    },
  }
}

/**
 * Create an in-memory test database with the full schema applied.
 * Returns a better-sqlite3-compatible API powered by sql.js.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON')

  // Apply full schema
  db.exec(DATABASE_SCHEMA)

  return createAdapter(db)
}
