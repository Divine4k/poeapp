-- Run once on the D1 database (dashboard: the database's Console tab, or `wrangler d1 execute`).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  pass TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0, -- 1: admin (Developer tools, roles, anyone's pictures in the item list)
  role TEXT NOT NULL DEFAULT ''     -- 'moderator': may record and send troubleshooting recordings; admins go by `admin`
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens (user_id);
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  divine REAL NOT NULL,
  strategy TEXT NOT NULL,
  totals TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS hits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL
);
-- The shared item list, one row per picture; json is the entry as the apps download it.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  by_name TEXT NOT NULL,
  json TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_name ON items (name);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
