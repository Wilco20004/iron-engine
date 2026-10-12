import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.IRON_DATA_DIR || path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'iron-engine.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    program_id TEXT NOT NULL,       -- template used when the next block starts
    age INTEGER,
    pin_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  -- Program templates. Seeded from server/programs/*.json; templates edited
  -- through the connector are marked customized and no longer follow the file.
  CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    source TEXT NOT NULL,           -- 'file' or 'connector'
    file_hash TEXT,
    customized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- Exercises added or changed through the connector; they override
  -- server/programs/exercises.json entries with the same name.
  CREATE TABLE IF NOT EXISTS exercises (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- A block is one run through a plan (e.g. 4 weeks). It keeps its own copy of
  -- the plan, so editing it never changes earlier blocks.
  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    program_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    UNIQUE (profile_id, number)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column);
}

if (!hasColumn('profiles', 'notes')) {
  db.exec(`ALTER TABLE profiles ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
}

// log_entries: one row per logged item (an exercise, the cardio, or an
// "ended early" note) within a block. Version 1 had no block_id; that table
// is moved aside here and copied across by migrateLegacyLog() in store.ts.
const logExists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'log_entries'`).get();
if (logExists && !hasColumn('log_entries', 'block_id')) {
  db.exec(`ALTER TABLE log_entries RENAME TO log_entries_v1`);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS log_entries (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    key TEXT NOT NULL,              -- "<week>-<day>-<exercise slug | cardio | end>"
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, block_id, key)
  );
`);

export type ProfileRow = {
  id: string;
  name: string;
  program_id: string;
  age: number | null;
  pin_hash: string | null;
  notes: string;
  created_at: string;
};

export type BlockRow = {
  id: number;
  profile_id: string;
  number: number;
  program_id: string;
  plan: string;
  started_at: string;
  ended_at: string | null;
};
