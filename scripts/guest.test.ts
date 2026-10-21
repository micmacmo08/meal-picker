import assert from "node:assert/strict";
import {
  aggregateGuestShopping,
  clearGuestPlans,
  GUEST_PLANS_STORAGE_KEY,
  loadGuestPlans,
  parseGuestQuantity,
  removeGuestPlan,
  saveGuestPlans,
  setGuestPlanComplete,
  upsertGuestPlan,
  type GuestPlan,
} from "../client/src/guest.js";
import type { Meal, MealIngredient } from "../client/src/api.js";

function ingredient(
  id: number,
  ingredientId: number,
  ingredientName: string,
  quantity: string | null,
  measurement: string | null,
  descriptor: string | null,
): MealIngredient {
  return {
    id,
    ingredient_id: ingredientId,
    ingredient: ingredientName,
    quantity,
    measurement,
    descriptor,
  };
}

function meal(id: number, name: string, ingredients: MealIngredient[]): Meal {
  return {
    id,
    name,
    legacy_ingredients: "",
    ingredients,
    recipe: "",
    mikes_rating: null,
    michelles_rating: null,
    hidden: false,
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const alpha = meal(101, "Alpha Stew", [
  ingredient(1, 1, "Flour", "1 1/2", "Cups", "sifted"),
  ingredient(2, 2, "Sugar", "0.5", "cup", null),
  ingredient(3, 3, "Vanilla", "a splash", null, "for sauce"),
  ingredient(4, 4, "Onion", "1", "whole", "diced"),
]);
const beta = meal(102, "Beta Bake", [
  ingredient(5, 1, "Flour", "2 1/2", "cups", "for dusting"),
  ingredient(6, 2, "Sugar", "1/4", "Cup", null),
  ingredient(7, 3, "Vanilla", "to taste", null, "warm"),
  ingredient(8, 4, "Onion", "2", "Whole", "chopped"),
]);
const completed = meal(103, "Completed Casserole", [
  ingredient(9, 1, "Flour", "100", "cups", "must not appear"),
  ingredient(10, 5, "Completed-only herb", "1", "bunch", null),
]);

const guestPlans: GuestPlan[] = [
  {
    id: "guest-2026-01-02",
    plan_date: "2026-01-02",
    meal_id: beta.id,
    completed_at: null,
  },
  {
    id: "guest-2026-01-03",
    plan_date: "2026-01-03",
    meal_id: completed.id,
    completed_at: "2026-01-03T12:00:00.000Z",
  },
  {
    id: "guest-2026-01-01",
    plan_date: "2026-01-01",
    meal_id: alpha.id,
    completed_at: null,
  },
];

assert.equal(parseGuestQuantity("1 1/2"), 1.5);
assert.equal(parseGuestQuantity("0.5"), 0.5);
assert.equal(parseGuestQuantity("a splash"), null);

assert.deepEqual(aggregateGuestShopping(guestPlans, [alpha, beta, completed]), [
  {
    key: "1:cups",
    ingredient_id: 1,
    ingredient: "Flour",
    measurement: "Cups",
    quantity: "4",
    descriptors: ["sifted", "for dusting"],
    meal_names: ["Alpha Stew", "Beta Bake"],
  },
  {
    key: "4:whole",
    ingredient_id: 4,
    ingredient: "Onion",
    measurement: "whole",
    quantity: "3",
    descriptors: ["diced", "chopped"],
    meal_names: ["Alpha Stew", "Beta Bake"],
  },
  {
    key: "2:cup",
    ingredient_id: 2,
    ingredient: "Sugar",
    measurement: "cup",
    quantity: "0.75",
    descriptors: [],
    meal_names: ["Alpha Stew", "Beta Bake"],
  },
  {
    key: "3:",
    ingredient_id: 3,
    ingredient: "Vanilla",
    measurement: null,
    quantity: "a splash + to taste",
    descriptors: ["for sauce", "warm"],
    meal_names: ["Alpha Stew", "Beta Bake"],
  },
]);

class FakeStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new FakeStorage();
let storedPlans = upsertGuestPlan([], "2026-02-02", beta.id);
storedPlans = upsertGuestPlan(storedPlans, "2026-02-01", alpha.id);
assert.deepEqual(
  storedPlans.map((plan) => plan.plan_date),
  ["2026-02-01", "2026-02-02"],
);
storedPlans = upsertGuestPlan(storedPlans, "2026-02-01", beta.id);
assert.equal(storedPlans[0]?.meal_id, beta.id);
assert.equal(storedPlans[0]?.completed_at, null);
storedPlans = setGuestPlanComplete(
  storedPlans,
  storedPlans[0]!.id,
  true,
  new Date("2026-02-01T15:00:00.000Z"),
);
assert.equal(storedPlans[0]?.completed_at, "2026-02-01T15:00:00.000Z");
saveGuestPlans(storedPlans, storage);
assert.ok(storage.values.has(GUEST_PLANS_STORAGE_KEY));
assert.deepEqual(loadGuestPlans(storage), storedPlans);
storedPlans = removeGuestPlan(storedPlans, storedPlans[0]!.id);
assert.equal(storedPlans.length, 1);
clearGuestPlans(storage);
assert.equal(storage.values.has(GUEST_PLANS_STORAGE_KEY), false);
assert.deepEqual(loadGuestPlans(storage), []);

console.log(
  "PASS  guest shopping aggregation parity fixture + session-storage plan operations",
);
