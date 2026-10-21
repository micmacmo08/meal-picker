// Smoke test: runs against a live server (default http://localhost:3000).
// Start the server first (npm run dev / npm start), then `npm run smoke`.
// If MEAL_PICKER_PASSWORD is set in this script's environment, it logs in
// first so mutating endpoints can be exercised.
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const PASSWORD = process.env.MEAL_PICKER_PASSWORD;

let cookie = "";
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures += 1;
}
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML etc. */ }
  return { status: res.status, json, text };
}

const today = new Date();
const planDate = (offset) => {
  const d = new Date(today.getTime() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

// Health + final access model. These unauthenticated checks must run before
// login populates the cookie jar.
let r = await call("GET", "/api/health");
check("GET /api/health", r.status === 200 && r.json?.ok === true);
if (PASSWORD) {
  r = await call("GET", "/api/plans");
  check("GET /api/plans without login -> 401", r.status === 401);
  r = await call("GET", "/api/shopping");
  check("GET /api/shopping without login -> 401", r.status === 401);
  r = await call("GET", "/api/library");
  check("GET /api/library without login -> 401", r.status === 401);
  r = await call("GET", "/api/meals");
  check("GET /api/meals without login -> 200", r.status === 200);
  r = await call("GET", "/api/pick");
  check("GET /api/pick without login -> 200", r.status === 200 && r.json?.selected !== undefined);
  r = await call("POST", "/api/pick", { tagIds: [] });
  check("POST /api/pick without login -> 200", r.status === 200 && r.json?.selected);
  r = await call("POST", "/api/tags", { name: "must-not-be-created" });
  check("POST /api/tags without login -> 401", r.status === 401);
  r = await call("POST", "/api/auth/login", { password: "wrong" });
  check("POST /api/auth/login wrong password -> 401", r.status === 401);
  r = await call("POST", "/api/auth/login", { password: PASSWORD });
  check("POST /api/auth/login", r.status === 200 && r.json?.ok === true);
  r = await call("GET", "/api/plans");
  check("GET /api/plans with login -> 200", r.status === 200);
  r = await call("GET", "/api/shopping");
  check("GET /api/shopping with login -> 200", r.status === 200);
}

// Library + seeded counts
r = await call("GET", "/api/library");
check("GET /api/library", r.status === 200);
check("seeded meals = 13", r.json?.meals?.length === 13, `got ${r.json?.meals?.length}`);
check("seeded tags = 9", r.json?.tags?.length === 9, `got ${r.json?.tags?.length}`);
const allIngredients = new Set((r.json?.meals ?? []).flatMap((m) => m.ingredients.map((i) => i.ingredient_id)));
check("seeded ingredients = 72 (via meals)", allIngredients.size === 72, `got ${allIngredients.size}`);
const miCount = (r.json?.meals ?? []).reduce((n, m) => n + m.ingredients.length, 0);
check("seeded meal_ingredients = 129 (via meals)", miCount === 129, `got ${miCount}`);
check("all ratings NULL after seed", (r.json?.meals ?? []).every((m) => m.mikes_rating === null && m.michelles_rating === null));
const meal1 = r.json.meals[0];
const anyMeal = r.json.meals.find((m) => m.ingredients.length > 0);

// Meals list + filters
r = await call("GET", "/api/meals");
check("GET /api/meals", r.status === 200 && r.json.meals.length >= 1);
const firstTag = r.json.meals.find((m) => m.tag_ids.length > 0)?.tag_ids[0];
if (firstTag) {
  r = await call("GET", `/api/meals?tagIds=${firstTag}`);
  check("GET /api/meals?tagIds filter (AND semantics)", r.status === 200 && r.json.meals.every((m) => m.tag_ids.includes(firstTag)));
}
r = await call("GET", `/api/meals/${meal1.id}`);
check("GET /api/meals/:id", r.status === 200 && r.json.meal.id === meal1.id);
r = await call("GET", "/api/meals/999999");
check("GET /api/meals/:id missing -> 404", r.status === 404);

// Rating round-trip (incl. validation)
r = await call("PATCH", `/api/meals/${meal1.id}/ratings`, { mikesRating: 18, michellesRating: 12 });
check("PATCH ratings set", r.status === 200 && r.json.meal.mikes_rating === 18 && r.json.meal.michelles_rating === 12);
r = await call("PATCH", `/api/meals/${meal1.id}/ratings`, { mikesRating: 7 });
check("PATCH ratings partial (Michelle preserved)", r.status === 200 && r.json.meal.mikes_rating === 7 && r.json.meal.michelles_rating === 12);
r = await call("PATCH", `/api/meals/${meal1.id}/ratings`, { mikesRating: 21 });
check("PATCH ratings 21 -> 400", r.status === 400);
r = await call("PATCH", `/api/meals/${meal1.id}/ratings`, { mikesRating: 2.5 });
check("PATCH ratings 2.5 -> 400", r.status === 400);
r = await call("PATCH", `/api/meals/${meal1.id}/ratings`, { mikesRating: null, michellesRating: null });
check("PATCH ratings clear to null", r.status === 200 && r.json.meal.mikes_rating === null && r.json.meal.michelles_rating === null);

// Weighted pick
r = await call("POST", "/api/pick", { tagIds: [] });
check("POST /api/pick returns a meal", r.status === 200 && r.json.selected && r.json.eligible_count > 0, `eligible=${r.json?.eligible_count}`);
r = await call("GET", "/api/pick");
check("GET /api/pick", r.status === 200 && r.json.selected !== undefined);

// Create / update / delete meal + tags + hide
r = await call("POST", "/api/tags", { name: "Smoke Test Tag" });
check("POST /api/tags (normalized)", (r.status === 200 || r.status === 201) && r.json.name === "smoke-test-tag");
const smokeTagId = r.json.id;
r = await call("POST", "/api/meals", {
  name: "Smoke Test Meal",
  ingredients: [{ ingredient: "smoke tofu", quantity: "2", measurement: "blocks" }],
  recipe: "Smoke it.",
  mikesRating: null,
  michellesRating: null,
  tagIds: [],
});
check("POST /api/meals create", r.status === 201 && Number.isInteger(r.json.id));
const smokeMealId = r.json.id;
r = await call("PUT", `/api/meals/${smokeMealId}/tags`, { tagIds: [smokeTagId] });
check("PUT /api/meals/:id/tags assignment", r.status === 200 && r.json.meal.tag_ids.includes(smokeTagId));
r = await call("PUT", `/api/meals/${smokeMealId}`, {
  name: "Smoke Test Meal v2",
  ingredients: [{ ingredient: "smoke tofu", quantity: "3", measurement: "blocks" }],
  recipe: "Smoke it twice.",
  mikesRating: null,
  michellesRating: null,
  tagIds: [smokeTagId],
});
check("PUT /api/meals/:id update", r.status === 200);
r = await call("POST", `/api/meals/${smokeMealId}/hidden`, { hidden: true });
check("POST hide meal", r.status === 200);
r = await call("GET", "/api/meals");
check("hidden meal excluded by default", r.status === 200 && !r.json.meals.some((m) => m.id === smokeMealId));
r = await call("GET", "/api/meals?includeHidden=true");
check("hidden meal visible with includeHidden", r.status === 200 && r.json.meals.some((m) => m.id === smokeMealId));
r = await call("POST", `/api/meals/${smokeMealId}/hidden`, { hidden: false });
check("POST unhide meal", r.status === 200);

// Plans + shopping list lifecycle
const d1 = planDate(1);
r = await call("POST", "/api/plans", { planDate: d1, mealId: anyMeal.id });
check("POST /api/plans add", (r.status === 200 || r.status === 201) && r.json.ok === true);
const planId = r.json.id;
r = await call("GET", `/api/plans?from=${planDate(0)}&to=${planDate(2)}`);
check("GET /api/plans range includes new plan", r.status === 200 && r.json.plans.some((p) => p.id === planId));
r = await call("GET", "/api/shopping");
const shopNames = new Set((r.json?.shopping ?? []).flatMap((s) => s.meal_names));
check("shopping list includes planned meal's ingredients", r.status === 200 && shopNames.has(anyMeal.name));
r = await call("PATCH", `/api/plans/${planId}/complete`, { complete: true });
check("PATCH plan complete", r.status === 200 && r.json.ok === true);
r = await call("GET", "/api/shopping");
const shopNamesAfter = new Set((r.json?.shopping ?? []).flatMap((s) => s.meal_names));
check("shopping list excludes completed plan", r.status === 200 && !shopNamesAfter.has(anyMeal.name));
r = await call("PATCH", `/api/plans/${planId}/complete`, { complete: false });
check("PATCH plan uncomplete", r.status === 200);
r = await call("DELETE", `/api/plans/${planId}`);
check("DELETE plan", r.status === 200);

// Cleanup smoke meal + tag
r = await call("DELETE", `/api/meals/${smokeMealId}`);
check("DELETE meal", r.status === 200);
r = await call("DELETE", `/api/tags/${smokeTagId}`);
check("DELETE tag", r.status === 200);

// Built single-page app
const home = await fetch(BASE + "/");
const homeText = await home.text();
check(
  "GET / serves built SPA index",
  home.status === 200 && homeText.includes("Meal Picker") && homeText.includes('id="root"'),
);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
