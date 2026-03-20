/**
 * SQLite Adapter - Runtime-agnostic SQLite abstraction layer
 * 
 * This module provides a unified API that works with:
 * - bun:sqlite (Bun runtime)
 * - better-sqlite3 (Node.js runtime)
 * 
 * Both libraries have similar synchronous APIs, but with some differences
 * that this adapter normalizes.
 */

import assert from 'node:assert';
import { createRequire } from 'node:module';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unified statement interface
 */
export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Result from running a statement (INSERT/UPDATE/DELETE)
 */
export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Unified database interface
 */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(pragma: string): unknown;
  close(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect if we're running in Bun
 */
export function isBunRuntime(): boolean {
  return typeof globalThis !== 'undefined' && 
         'Bun' in globalThis && 
         typeof (globalThis as Record<string, unknown>).Bun === 'object';
}

// ── Cache runtime check result ──
const IS_BUN = isBunRuntime();

// ═══════════════════════════════════════════════════════════════════════════════
// BUN SQLITE ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a database adapter for Bun's built-in SQLite
 */
function createBunAdapter(dbPath: string): SqliteDatabase {
  assert(IS_BUN, '[BUN_ADAPTER] This function should only be called in Bun runtime');
  
  // ── Bun natively supports require for built-in modules ──
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite');
  
  const db = new Database(dbPath);
  assert(db !== null, '[BUN_ADAPTER] Failed to create Bun database');

  // ── Helper to get last insert rowid ──
  const getLastInsertRowid = (): number | bigint => {
    const result = db.query('SELECT last_insert_rowid() as id').get() as { id: number | bigint } | null;
    return result?.id ?? 0;
  };

  // ── Helper to get changes count ──
  const getChanges = (): number => {
    const result = db.query('SELECT changes() as count').get() as { count: number } | null;
    return result?.count ?? 0;
  };

  return {
    exec(sql: string): void {
      assert(typeof sql === 'string', '[BUN_ADAPTER] exec: sql must be a string');
      assert(sql.length > 0, '[BUN_ADAPTER] exec: sql cannot be empty');
      db.exec(sql);
    },

    prepare(sql: string): SqliteStatement {
      assert(typeof sql === 'string', '[BUN_ADAPTER] prepare: sql must be a string');
      assert(sql.length > 0, '[BUN_ADAPTER] prepare: sql cannot be empty');
      
      const stmt = db.prepare(sql);
      assert(stmt !== null, '[BUN_ADAPTER] prepare: Failed to create statement');

      return {
        run(...params: unknown[]): SqliteRunResult {
          // ── Bun's run() doesn't return useful info, query separately ──
          stmt.run(...params);
          
          return {
            changes: getChanges(),
            lastInsertRowid: getLastInsertRowid()
          };
        },

        get(...params: unknown[]): unknown {
          return stmt.get(...params);
        },

        all(...params: unknown[]): unknown[] {
          const result = stmt.all(...params);
          assert(Array.isArray(result), '[BUN_ADAPTER] all: result must be an array');
          return result;
        }
      };
    },

    pragma(pragma: string): unknown {
      assert(typeof pragma === 'string', '[BUN_ADAPTER] pragma: pragma must be a string');
      // ── Bun uses exec for pragmas that don't return values ──
      // ── For pragmas that return values, we need to query ──
      if (pragma.includes('=')) {
        // ── Setting a pragma ──
        db.exec(`PRAGMA ${pragma}`);
        return undefined;
      } else {
        // ── Getting a pragma value ──
        const result = db.query(`PRAGMA ${pragma}`).get();
        return result;
      }
    },

    close(): void {
      db.close();
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BETTER-SQLITE3 ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a database adapter for better-sqlite3
 */
function createBetterSqlite3Adapter(dbPath: string): SqliteDatabase {
  assert(!IS_BUN, '[BETTER_SQLITE3_ADAPTER] This function should only be called in Node.js runtime');
  
  // ── Use createRequire for CommonJS module in ESM context ──
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  
  const db = new Database(dbPath);
  assert(db !== null, '[BETTER_SQLITE3_ADAPTER] Failed to create database');

  return {
    exec(sql: string): void {
      assert(typeof sql === 'string', '[BETTER_SQLITE3_ADAPTER] exec: sql must be a string');
      assert(sql.length > 0, '[BETTER_SQLITE3_ADAPTER] exec: sql cannot be empty');
      db.exec(sql);
    },

    prepare(sql: string): SqliteStatement {
      assert(typeof sql === 'string', '[BETTER_SQLITE3_ADAPTER] prepare: sql must be a string');
      assert(sql.length > 0, '[BETTER_SQLITE3_ADAPTER] prepare: sql cannot be empty');
      
      const stmt = db.prepare(sql);
      assert(stmt !== null, '[BETTER_SQLITE3_ADAPTER] prepare: Failed to create statement');

      return {
        run(...params: unknown[]): SqliteRunResult {
          const result = stmt.run(...params);
          assert(result !== null && typeof result === 'object', '[BETTER_SQLITE3_ADAPTER] run: result must be an object');
          
          return {
            changes: result.changes ?? 0,
            lastInsertRowid: result.lastInsertRowid ?? 0
          };
        },

        get(...params: unknown[]): unknown {
          return stmt.get(...params);
        },

        all(...params: unknown[]): unknown[] {
          const result = stmt.all(...params);
          assert(Array.isArray(result), '[BETTER_SQLITE3_ADAPTER] all: result must be an array');
          return result;
        }
      };
    },

    pragma(pragma: string): unknown {
      assert(typeof pragma === 'string', '[BETTER_SQLITE3_ADAPTER] pragma: pragma must be a string');
      return db.pragma(pragma);
    },

    close(): void {
      db.close();
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a database adapter for the current runtime.
 * Automatically detects whether to use bun:sqlite or better-sqlite3.
 */
export function createDatabaseAdapter(dbPath: string): SqliteDatabase {
  assert(typeof dbPath === 'string', '[ADAPTER] dbPath must be a string');
  assert(dbPath.length > 0, '[ADAPTER] dbPath cannot be empty');
  
  if (IS_BUN) {
    return createBunAdapter(dbPath);
  } else {
    return createBetterSqlite3Adapter(dbPath);
  }
}

/**
 * Get the name of the SQLite library being used
 */
export function getSqliteBackendName(): string {
  return IS_BUN ? 'bun:sqlite' : 'better-sqlite3';
}
