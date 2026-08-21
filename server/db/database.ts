import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Database path setting (can be overridden for testing via process.env.DB_PATH)
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const defaultDbPath = isVercel
  ? '/tmp/queuecraft.db'
  : path.join(process.env.INIT_CWD || process.cwd(), 'queuecraft.db');

const dbPath = process.env.DB_PATH || defaultDbPath;

let dbInstance: any = null;

function createDummyDb(): any {
  const dummyStatement = {
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    get: () => undefined,
    all: () => [],
  };
  return {
    exec: () => {},
    pragma: () => {},
    prepare: () => dummyStatement,
    transaction: (fn: any) => fn,
    close: () => {},
  };
}

function createNodeSqliteAdapter(filePath: string, isVercel: boolean): any {
  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(filePath);

  const adapter = {
    rawDb,
    pragma: (cmd: string) => {
      const fullCmd = cmd.trim().toUpperCase().startsWith('PRAGMA') ? cmd : 'PRAGMA ' + cmd;
      return rawDb.exec(fullCmd);
    },
    exec: (sql: string) => {
      return rawDb.exec(sql);
    },
    prepare: (sql: string) => {
      const stmt = rawDb.prepare(sql);
      return {
        get: (...params: any[]) => {
          const sanitized = params.map(p => (p === undefined ? null : p));
          return stmt.get(...sanitized);
        },
        all: (...params: any[]) => {
          const sanitized = params.map(p => (p === undefined ? null : p));
          return stmt.all(...sanitized);
        },
        run: (...params: any[]) => {
          const sanitized = params.map(p => (p === undefined ? null : p));
          const res = stmt.run(...sanitized);
          return {
            changes: Number(res.changes || 0),
            lastInsertRowid: res.lastInsertRowid,
          };
        },
      };
    },
    transaction: (fn: Function) => {
      return (...args: any[]) => {
        rawDb.exec('BEGIN IMMEDIATE;');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT;');
          return result;
        } catch (err) {
          rawDb.exec('ROLLBACK;');
          throw err;
        }
      };
    },
    close: () => {
      rawDb.close();
    },
  };

  adapter.pragma('foreign_keys = ON');
  if (!isVercel) {
    adapter.pragma('journal_mode = WAL');
  }

  return adapter;
}

export function getDb(): any {
  if (!dbInstance) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // 1. Try better-sqlite3
    try {
      const Database = require('better-sqlite3');
      dbInstance = new Database(dbPath);
      dbInstance.pragma('foreign_keys = ON');
      if (!isVercel) {
        dbInstance.pragma('journal_mode = WAL');
      }
    } catch (err: any) {
      // 2. Try Node built-in node:sqlite (available in Node 22.5+, 24+, 26+)
      try {
        dbInstance = createNodeSqliteAdapter(dbPath, isVercel);
        console.log('[Database] Real SQLite connected via Node built-in node:sqlite engine.');
      } catch (nodeSqliteErr: any) {
        console.error('[Database] FATAL: failed to initialize the real SQLite database.', err);

        if (process.env.ALLOW_DUMMY_DB === 'true') {
          console.error(
            '[Database] ALLOW_DUMMY_DB=true is set: continuing with a no-op in-memory ' +
            'dummy database. ALL reads/writes will silently discard data.'
          );
          dbInstance = createDummyDb();
        } else {
          throw new Error(
            `Failed to initialize real SQLite database (${dbPath}): ${err.message}. ` +
            `node:sqlite error: ${nodeSqliteErr.message}`
          );
        }
      }
    }
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}
