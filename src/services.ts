// Core domain logic, ported from the old artifact's server/src/actions.ts.
// Read/write helpers are synchronous because better-sqlite3 is synchronous.
import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";

export interface MealIngredientOut {
  id: number;
  ingredient_id: number;
  ingredient: string;
  quantity: string | null;
  measurement: string | null;
  descriptor: string | null;
}

export interface MealOut {
  id: number;
  name: string;
  legacy_ingredients: string;
  ingredients: MealIngredientOut[];
  recipe: string;
  mikes_rating: number | null;
  michelles_rating: number | null;
  hidden: boolean;
  tag_ids: number[];
  updated_at: string;
}

export interface PlanOut {
  id: number;
  plan_date: string;
  meal_id: number;
  meal_name: string;
  completed_at: string | null;
}

export interface ShoppingOut {
  key: string;
  ingredient_id: number;
  ingredient: string;
  measurement: string | null;
  quantity: string | null;
  descriptors: string[];
  meal_names: string[];
}

export function cleanOptional(value: string | undefined): string | null {
  const cleaned = value?.trim() ?? "";
  return cleaned ? cleaned : null;
}

export function normalizeIngredient(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function parseQuantity(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const fraction = trimmed.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (!fraction) return null;
  const whole = Number(fraction[1] ?? 0);
  const numerator = Number(fraction[2] ?? 0);
  const denominator = Number(fraction[3] ?? 0);
  if (!denominator) return null;
  return whole + numerator / denominator;
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** Weight given to a meal with no ratings: 2.5 stars, in quarter units. */
export const UNRATED_WEIGHT = 10;

/**
 * Weighted-pick weight: the average of whichever per-person ratings exist
 * (quarter units 1..20). A completely unrated meal weighs as if it were
 * rated 2.5 stars (10 quarter units), so it is drawn more often than a meal
 * rated 1 star (weight 4) while remaining below well-rated favourites.
 */
export function ratingWeight(meal: Pick<MealOut, "mikes_rating" | "michelles_rating">): number {
  const ratings = [meal.mikes_rating, meal.michelles_rating].filter(
    (rating): rating is number => rating !== null,
  );
  if (ratings.length === 0) return UNRATED_WEIGHT;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

export function listTagRows(db: Db) {
  return db.select().from(schema.tags).orderBy(asc(schema.tags.name)).all();
}

export function listMealResponses(db: Db): MealOut[] {
  const mealRows = db.select().from(schema.meals).orderBy(asc(schema.meals.name)).all();
  const linkRows = db.select().from(schema.mealTags).all();
  const ingredientRows = db.select().from(schema.ingredients).all();
  const mealIngredientRows = db
    .select()
    .from(schema.mealIngredients)
    .orderBy(asc(schema.mealIngredients.sortOrder))
    .all();

  const tagsByMeal = new Map<number, number[]>();
  for (const link of linkRows) {
    const current = tagsByMeal.get(link.mealId) ?? [];
    current.push(link.tagId);
    tagsByMeal.set(link.mealId, current);
  }
  const ingredientById = new Map(ingredientRows.map((item) => [item.id, item]));
  const ingredientsByMeal = new Map<number, MealIngredientOut[]>();
  for (const item of mealIngredientRows) {
    const ingredient = ingredientById.get(item.ingredientId);
    if (!ingredient) continue;
    const current = ingredientsByMeal.get(item.mealId) ?? [];
    current.push({
      id: item.id,
      ingredient_id: ingredient.id,
      ingredient: ingredient.name,
      quantity: item.quantity,
      measurement: item.measurement,
      descriptor: item.descriptor,
    });
    ingredientsByMeal.set(item.mealId, current);
  }

  return mealRows.map((meal) => ({
    id: meal.id,
    name: meal.name,
    legacy_ingredients: meal.ingredients,
    ingredients: ingredientsByMeal.get(meal.id) ?? [],
    recipe: meal.recipe,
    mikes_rating: meal.mikesRating,
    michelles_rating: meal.michellesRating,
    hidden: meal.hidden,
    tag_ids: tagsByMeal.get(meal.id) ?? [],
    updated_at: meal.updatedAt.toISOString(),
  }));
}

export function getMealResponse(db: Db, id: number): MealOut | null {
  return listMealResponses(db).find((meal) => meal.id === id) ?? null;
}

export function listPlanResponses(db: Db, from?: string, to?: string): PlanOut[] {
  const mealRows = db.select().from(schema.meals).all();
  const mealById = new Map(mealRows.map((meal) => [meal.id, meal]));
  return db
    .select()
    .from(schema.mealPlans)
    .orderBy(asc(schema.mealPlans.planDate))
    .all()
    .filter((plan) => (!from || plan.planDate >= from) && (!to || plan.planDate <= to))
    .flatMap((plan) => {
      const meal = mealById.get(plan.mealId);
      if (!meal) return [];
      return [
        {
          id: plan.id,
          plan_date: plan.planDate,
          meal_id: plan.mealId,
          meal_name: meal.name,
          completed_at: plan.completedAt?.toISOString() ?? null,
        },
      ];
    });
}

/**
 * Shopping list aggregation, ported from the old loadLibrary():
 * groups by (ingredient, lowercased measurement) across all plans that are
 * NOT marked complete, sums quantities that parse as numbers (decimals and
 * fractions like "1 1/2"), and appends non-numeric quantities as text.
 */
export function buildShoppingList(db: Db): ShoppingOut[] {
  const meals = listMealResponses(db);
  const mealById = new Map(meals.map((meal) => [meal.id, meal]));
  const plans = listPlanResponses(db);

  type Acc = {
    key: string;
    ingredient_id: number;
    ingredient: string;
    measurement: string | null;
    numericTotal: number;
    numericCount: number;
    textQuantities: string[];
    descriptors: Set<string>;
    mealNames: Set<string>;
  };
  const map = new Map<string, Acc>();
  for (const plan of plans) {
    if (plan.completed_at) continue;
    const meal = mealById.get(plan.meal_id);
    if (!meal) continue;
    for (const item of meal.ingredients) {
      const measurementKey = item.measurement?.trim().toLocaleLowerCase() ?? "";
      const key = `${item.ingredient_id}:${measurementKey}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          ingredient_id: item.ingredient_id,
          ingredient: item.ingredient,
          measurement: item.measurement,
          numericTotal: 0,
          numericCount: 0,
          textQuantities: [],
          descriptors: new Set<string>(),
          mealNames: new Set<string>(),
        };
        map.set(key, row);
      }
      const numeric = parseQuantity(item.quantity);
      if (numeric === null) {
        if (item.quantity) row.textQuantities.push(item.quantity);
      } else {
        row.numericTotal += numeric;
        row.numericCount += 1;
      }
      if (item.descriptor) row.descriptors.add(item.descriptor);
      row.mealNames.add(plan.meal_name);
    }
  }
  return [...map.values()]
    .map((row) => {
      const quantities: string[] = [];
      if (row.numericCount > 0) quantities.push(formatQuantity(row.numericTotal));
      quantities.push(...row.textQuantities);
      return {
        key: row.key,
        ingredient_id: row.ingredient_id,
        ingredient: row.ingredient,
        measurement: row.measurement,
        quantity: quantities.length ? quantities.join(" + ") : null,
        descriptors: [...row.descriptors],
        meal_names: [...row.mealNames],
      };
    })
    .sort((a, b) => a.ingredient.localeCompare(b.ingredient));
}

export interface MealInput {
  name: string;
  ingredients: { ingredient: string; quantity?: string; measurement?: string; descriptor?: string }[];
  recipe: string;
  mikesRating: number | null;
  michellesRating: number | null;
  tagIds: number[];
}

/** Create or update (when id is given) a meal, its tag links and ingredient lines. Port of saveMeal. */
export function saveMeal(db: Db, input: MealInput, id?: number): number {
  const now = new Date();
  const ingredientSummary = input.ingredients
    .map((item) => [item.quantity, item.measurement, item.ingredient, item.descriptor].filter(Boolean).join(" "))
    .join("\n");

  let mealId = id;
  db.transaction((tx) => {
    if (mealId) {
      const existing = tx.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.id, mealId)).all();
      if (!existing[0]) throw new Error("That meal no longer exists.");
      tx.update(schema.meals)
        .set({
          name: input.name,
          ingredients: ingredientSummary,
          recipe: input.recipe,
          mikesRating: input.mikesRating,
          michellesRating: input.michellesRating,
          updatedAt: now,
        })
        .where(eq(schema.meals.id, mealId))
        .run();
      tx.delete(schema.mealTags).where(eq(schema.mealTags.mealId, mealId)).run();
      tx.delete(schema.mealIngredients).where(eq(schema.mealIngredients.mealId, mealId)).run();
    } else {
      const inserted = tx
        .insert(schema.meals)
        .values({
          name: input.name,
          ingredients: ingredientSummary,
          recipe: input.recipe,
          mikesRating: input.mikesRating,
          michellesRating: input.michellesRating,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.meals.id })
        .get();
      if (!inserted) throw new Error("The meal could not be saved.");
      mealId = inserted.id;
    }

    const validIds = new Set(tx.select({ id: schema.tags.id }).from(schema.tags).all().map((tag) => tag.id));
    const uniqueTagIds = [...new Set(input.tagIds)].filter((tagId) => validIds.has(tagId));
    if (uniqueTagIds.length > 0 && mealId) {
      tx.insert(schema.mealTags).values(uniqueTagIds.map((tagId) => ({ mealId: mealId!, tagId }))).run();
    }

    for (const [index, item] of input.ingredients.entries()) {
      const normalizedName = normalizeIngredient(item.ingredient);
      const existing = tx
        .select()
        .from(schema.ingredients)
        .where(eq(schema.ingredients.normalizedName, normalizedName))
        .all();
      let ingredientId = existing[0]?.id;
      if (!ingredientId) {
        const inserted = tx
          .insert(schema.ingredients)
          .values({ name: item.ingredient.trim(), normalizedName, createdAt: now })
          .returning({ id: schema.ingredients.id })
          .get();
        ingredientId = inserted?.id;
      }
      if (!ingredientId || !mealId) throw new Error("An ingredient could not be saved.");
      tx.insert(schema.mealIngredients)
        .values({
          mealId,
          ingredientId,
          quantity: cleanOptional(item.quantity),
          measurement: cleanOptional(item.measurement),
          descriptor: cleanOptional(item.descriptor),
          sortOrder: index,
        })
        .run();
    }
  });
  if (!mealId) throw new Error("The meal could not be saved.");
  return mealId;
}

/** Weighted random pick. Port of pickMeal: hidden meals excluded; a meal must carry ALL requested tags. */
export function pickMeal(db: Db, tagIds: number[]): { selected: MealOut | null; eligible_count: number } {
  const selectedTags = new Set(tagIds);
  const eligible = listMealResponses(db).filter((meal) => {
    if (meal.hidden) return false;
    if (selectedTags.size === 0) return true;
    const mealTagSet = new Set(meal.tag_ids);
    return tagIds.every((tagId) => mealTagSet.has(tagId));
  });
  const totalWeight = eligible.reduce((sum, meal) => sum + ratingWeight(meal), 0);
  if (eligible.length === 0 || totalWeight <= 0) return { selected: null, eligible_count: 0 };
  let needle = Math.random() * totalWeight;
  let chosen = eligible[eligible.length - 1] ?? null;
  for (const meal of eligible) {
    needle -= ratingWeight(meal);
    if (needle < 0) {
      chosen = meal;
      break;
    }
  }
  return { selected: chosen, eligible_count: eligible.length };
}
