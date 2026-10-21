// Ported 1:1 (semantics and column names) from the original artifact schema:
// ~/workspace/ts-spaces/meal-picker/server/src/schema.ts
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const meals = sqliteTable("meals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Legacy denormalized ingredient summary text, kept for parity with the old app.
  ingredients: text("ingredients").notNull(),
  recipe: text("recipe").notNull(),
  // Ratings are integer quarter-star units, 1..20 (i.e. 0.25..5 stars), or NULL (not rated).
  mikesRating: integer("mikes_rating"),
  michellesRating: integer("michelles_rating"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("tags_name_unique").on(table.name)],
);

export const mealTags = sqliteTable(
  "meal_tags",
  {
    mealId: integer("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("meal_tags_unique").on(table.mealId, table.tagId)],
);

export const ingredients = sqliteTable(
  "ingredients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("ingredients_normalized_name_unique").on(table.normalizedName)],
);

export const mealIngredients = sqliteTable(
  "meal_ingredients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mealId: integer("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id, { onDelete: "restrict" }),
    quantity: text("quantity"),
    measurement: text("measurement"),
    descriptor: text("descriptor"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("meal_ingredients_meal_idx").on(table.mealId)],
);

export const mealPlans = sqliteTable(
  "meal_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planDate: text("plan_date").notNull(), // YYYY-MM-DD, one meal per date
    mealId: integer("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("meal_plans_plan_date_unique").on(table.planDate),
    index("meal_plans_date_idx").on(table.planDate),
  ],
);
