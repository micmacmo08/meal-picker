import type { Meal, ShoppingItem } from "./api";

/**
 * Guest demo mode.
 *
 * A logged-out visitor's calendar lives only in this module's
 * sessionStorage entry for the current browser tab. Guest plan operations
 * are pure/local: they never call the plans or shopping APIs, and household
 * (server) plan data is never copied into this store.
 */
export const GUEST_PLANS_STORAGE_KEY = "meal-picker:guest-plans:v1";

export interface GuestPlan {
  /** Local-only identifier; never a server plan id. */
  id: string;
  plan_date: string;
  meal_id: number;
  completed_at: string | null;
}

type GuestPlanStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): GuestPlanStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isGuestPlan(value: unknown): value is GuestPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Partial<GuestPlan>;
  return (
    typeof plan.id === "string" &&
    typeof plan.plan_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(plan.plan_date) &&
    typeof plan.meal_id === "number" &&
    Number.isInteger(plan.meal_id) &&
    plan.meal_id > 0 &&
    (plan.completed_at === null || typeof plan.completed_at === "string")
  );
}

export function loadGuestPlans(
  storage: GuestPlanStorage | null = defaultStorage(),
): GuestPlan[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(GUEST_PLANS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // One plan per date, matching the server's upsert-by-date behaviour if
    // a hand-edited or older stored value somehow contains duplicates.
    const byDate = new Map<string, GuestPlan>();
    for (const plan of parsed) {
      if (isGuestPlan(plan)) byDate.set(plan.plan_date, plan);
    }
    return [...byDate.values()].sort((a, b) => a.plan_date.localeCompare(b.plan_date));
  } catch {
    return [];
  }
}

export function saveGuestPlans(
  plans: GuestPlan[],
  storage: GuestPlanStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (plans.length === 0) {
      storage.removeItem(GUEST_PLANS_STORAGE_KEY);
      return;
    }
    storage.setItem(GUEST_PLANS_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // Demo state is intentionally disposable; a full/blocked session store
    // must not break using the calendar for the current render.
  }
}

export function clearGuestPlans(
  storage: GuestPlanStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(GUEST_PLANS_STORAGE_KEY);
  } catch {
    // Nothing durable depends on this disposable demo state.
  }
}

export function upsertGuestPlan(
  plans: GuestPlan[],
  planDate: string,
  mealId: number,
): GuestPlan[] {
  const existing = plans.find((plan) => plan.plan_date === planDate);
  const next = existing
    ? plans.map((plan) =>
        plan.plan_date === planDate
          ? { ...plan, meal_id: mealId, completed_at: null }
          : plan,
      )
    : [
        ...plans,
        {
          id: `guest-${planDate}`,
          plan_date: planDate,
          meal_id: mealId,
          completed_at: null,
        },
      ];
  return next.sort((a, b) => a.plan_date.localeCompare(b.plan_date));
}

export function setGuestPlanComplete(
  plans: GuestPlan[],
  planId: string,
  complete: boolean,
  now = new Date(),
): GuestPlan[] {
  return plans.map((plan) =>
    plan.id === planId
      ? { ...plan, completed_at: complete ? now.toISOString() : null }
      : plan,
  );
}

export function removeGuestPlan(plans: GuestPlan[], planId: string): GuestPlan[] {
  return plans.filter((plan) => plan.id !== planId);
}

// ---------------------------------------------------------------------------
// Shopping aggregation.
//
// This intentionally mirrors buildShoppingList() in src/services.ts:
// incomplete plans only, grouping by ingredient + lowercased measurement,
// numeric quantities (including decimals, fractions and mixed numbers) are
// summed first, non-numeric quantities are appended as text, descriptors
// and meal names are insertion-ordered sets, and output is sorted by
// ingredient name.
// ---------------------------------------------------------------------------

export function parseGuestQuantity(value: string | null): number | null {
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

function formatGuestQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export interface GuestShoppingPlan {
  plan_date: string;
  meal_id: number;
  completed_at: string | null;
}

export function aggregateGuestShopping(
  plans: GuestShoppingPlan[],
  meals: Meal[],
): ShoppingItem[] {
  const mealById = new Map(meals.map((meal) => [meal.id, meal]));

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

  // The server returns plans in ascending date order; do the same here so
  // first-seen measurements and set ordering match for the same plan set.
  const orderedPlans = [...plans].sort((a, b) => a.plan_date.localeCompare(b.plan_date));
  for (const plan of orderedPlans) {
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
      const numeric = parseGuestQuantity(item.quantity);
      if (numeric === null) {
        if (item.quantity) row.textQuantities.push(item.quantity);
      } else {
        row.numericTotal += numeric;
        row.numericCount += 1;
      }
      if (item.descriptor) row.descriptors.add(item.descriptor);
      row.mealNames.add(meal.name);
    }
  }

  return [...map.values()]
    .map((row) => {
      const quantities: string[] = [];
      if (row.numericCount > 0) quantities.push(formatGuestQuantity(row.numericTotal));
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
