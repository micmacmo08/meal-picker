import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema.js";

// DDL mirrors the final state of the old artifact's drizzle migrations
// (0002 + 0003 + 0004 + 0005), minus the dropped legacy `rating_quarters` column.
export const DDL = `
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  recipe TEXT NOT NULL,
  mikes_rating INTEGER,
  michelles_rating INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE TABLE IF NOT EXISTS meal_tags (
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS meal_tags_unique ON meal_tags (meal_id, tag_id);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_normalized_name_unique ON ingredients (normalized_name);
CREATE TABLE IF NOT EXISTS meal_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity TEXT,
  measurement TEXT,
  descriptor TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meal_ingredients_meal_idx ON meal_ingredients (meal_id);
CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_plan_date_unique ON meal_plans (plan_date);
CREATE INDEX IF NOT EXISTS meal_plans_date_idx ON meal_plans (plan_date);
`;

export type Db = BetterSQLite3Database<typeof schema>;

export function databasePath(): string {
  return resolve(process.env.DATABASE_PATH ?? "./data/meal-picker.db");
}

/** Opens (creating if needed) the SQLite database and ensures the schema exists. */
export function openDb(path: string = databasePath()): { db: Db; sqlite: Database.Database; path: string } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, path };
}
