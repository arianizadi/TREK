import { closeDb, db } from './database';

try {
  const versionRow = db.prepare('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1').get() as { version?: number } | undefined;
  const usersTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!usersTable) {
    throw new Error('users table is missing after migrations');
  }
  console.log(`[DB] Preflight migration check complete — schema version ${versionRow?.version ?? 'unknown'}`);
} finally {
  closeDb();
}
