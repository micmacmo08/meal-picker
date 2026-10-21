// Seed migration: builds a fresh database for this project from the
// committed export at seed/seed-data.json (the normal path — works from any
// fresh clone, e.g. on the droplet). If OLD_DB_PATH is set explicitly, the
// rows are instead imported directly from that old artifact app.db.
//
//  - Carries over: meals, ingredients, meal_ingredients, tags, meal_tags
//    (IDs and timestamps preserved so cross-references stay intact).
//  - Ratings are FORCED TO NULL for every meal, regardless of old values:
//    the household deliberately cleared all ratings to re-rate fresh, and
//    that decision stands.
//  - meal_plans are NOT carried over (old planning data is stale history).
//
// Usage:
//   DATABASE_PATH=./data/meal-picker.db npm run seed          (from seed/seed-data.json)
//   OLD_DB_PATH=/path/to/old/app.db DATABASE_PATH=... npm run seed  (direct old-DB import)
//
// The target database file is recreated from scratch (deleted if it exists),
// so this is safe to re-run for a clean import but destructive by design.
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DDL, databasePath } from "../src/db/client.js";

type Row = Record<string, unknown>;

const newPath = databasePath();
const explicitOldPath = process.env.OLD_DB_PATH ? resolve(process.env.OLD_DB_PATH) : null;

if (explicitOldPath && resolve(explicitOldPath) === resolve(newPath)) {
  console.error("OLD_DB_PATH and DATABASE_PATH must be different files.");
  process.exit(1);
}
if (explicitOldPath && !existsSync(explicitOldPath)) {
  console.error(`Old database not found at ${explicitOldPath}.`);
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(newPath + suffix)) rmSync(newPath + suffix);
}

mkdirSync(dirname(newPath), { recursive: true });
const newDb = new Database(newPath);
newDb.pragma("journal_mode = WAL");
newDb.pragma("foreign_keys = ON");
newDb.exec(DDL);

let oldDb: Database.Database | null = null;
let meals: Row[], ingredients: Row[], mealIngredients: Row[], tags: Row[], mealTags: Row[];
let oldRated = 0;

if (explicitOldPath) {
  oldDb = new Database(explicitOldPath, { readonly: true });
  const all = (db: Database.Database, sql: string): Row[] => db.prepare(sql).all() as Row[];
  meals = all(oldDb, "SELECT * FROM meals ORDER BY id");
  ingredients = all(oldDb, "SELECT * FROM ingredients ORDER BY id");
  mealIngredients = all(oldDb, "SELECT * FROM meal_ingredients ORDER BY id");
  tags = all(oldDb, "SELECT * FROM tags ORDER BY id");
  mealTags = all(oldDb, "SELECT * FROM meal_tags ORDER BY meal_id, tag_id");
  oldRated = (all(
    oldDb,
    "SELECT COUNT(*) AS n FROM meals WHERE mikes_rating IS NOT NULL OR michelles_rating IS NOT NULL",
  )[0]?.n ?? 0) as number;
  console.log(`Seeding from old database: ${explicitOldPath}`);
} else {
  const seedJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../seed/seed-data.json");
  const data = JSON.parse(readFileSync(seedJsonPath, "utf8")) as Record<string, Row[]>;
  tags = data.tags;
  ingredients = data.ingredients;
  meals = data.meals;
  mealIngredients = data.meal_ingredients;
  mealTags = data.meal_tags;
  // The export contains no rating values at all by design (see header), so
  // there is nothing to count on the source side.
  oldRated = 0;
  console.log(`Seeding from export: ${seedJsonPath}`);
}

const insert = newDb.transaction(() => {
  const insTag = newDb.prepare(
    "INSERT INTO tags (id, name, created_at) VALUES (@id, @name, @created_at)",
  );
  for (const t of tags) insTag.run(t);

  const insIngredient = newDb.prepare(
    "INSERT INTO ingredients (id, name, normalized_name, created_at) VALUES (@id, @name, @normalized_name, @created_at)",
  );
  for (const i of ingredients) insIngredient.run(i);

  // Ratings forced to NULL on purpose — see header comment.
  const insMeal = newDb.prepare(
    `INSERT INTO meals (id, name, ingredients, recipe, mikes_rating, michelles_rating, hidden, created_at, updated_at)
     VALUES (@id, @name, @ingredients, @recipe, NULL, NULL, @hidden, @created_at, @updated_at)`,
  );
  for (const m of meals) insMeal.run(m);

  const insMealIngredient = newDb.prepare(
    `INSERT INTO meal_ingredients (id, meal_id, ingredient_id, quantity, measurement, descriptor, sort_order)
     VALUES (@id, @meal_id, @ingredient_id, @quantity, @measurement, @descriptor, @sort_order)`,
  );
  for (const mi of mealIngredients) insMealIngredient.run(mi);

  const insMealTag = newDb.prepare("INSERT INTO meal_tags (meal_id, tag_id) VALUES (@meal_id, @tag_id)");
  for (const mt of mealTags) insMealTag.run(mt);
});
insert();

const count = (table: string): number =>
  (newDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const ratedAfter = count("meals") > 0
  ? (newDb.prepare("SELECT COUNT(*) AS n FROM meals WHERE mikes_rating IS NOT NULL OR michelles_rating IS NOT NULL").get() as { n: number }).n
  : 0;

const report = {
  meals: { old: meals.length, new: count("meals") },
  ingredients: { old: ingredients.length, new: count("ingredients") },
  meal_ingredients: { old: mealIngredients.length, new: count("meal_ingredients") },
  tags: { old: tags.length, new: count("tags") },
  meal_tags: { old: mealTags.length, new: count("meal_tags") },
  meal_plans_carried_over: 0,
  meals_with_ratings_old: oldRated,
  meals_with_ratings_new: ratedAfter,
};
console.log(JSON.stringify(report, null, 2));

const mismatch = Object.entries(report)
  .filter(([k, v]) => typeof v === "object" && v !== null && "old" in v && (v as { old: number; new: number }).old !== (v as { old: number; new: number }).new)
  .map(([k]) => k);
if (mismatch.length > 0 || ratedAfter !== 0) {
  console.error(`SEED VERIFICATION FAILED: mismatched tables: ${mismatch.join(", ") || "(none)"}; rated meals after seed: ${ratedAfter}`);
  process.exit(1);
}
console.log(`Seed OK -> ${newPath}`);
oldDb?.close();
newDb.close();
