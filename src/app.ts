import express, { type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";
import {
  buildShoppingList,
  getMealResponse,
  listMealResponses,
  listPlanResponses,
  listTagRows,
  normalizeTag,
  pickMeal,
  saveMeal,
} from "./services.js";

const rating = z.number().int().min(1).max(20).nullable();
const ingredientInput = z.object({
  ingredient: z.string().trim().min(1).max(120),
  quantity: z.string().max(40).optional(),
  measurement: z.string().max(60).optional(),
  descriptor: z.string().max(100).optional(),
});
const mealBody = z.object({
  name: z.string().trim().min(1).max(120),
  ingredients: z.array(ingredientInput).min(1).max(80),
  recipe: z.string().trim().min(1).max(24000),
  mikesRating: rating,
  michellesRating: rating,
  tagIds: z.array(z.number().int().positive()).max(100),
});
const idParam = z.coerce.number().int().positive();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function parseTagIds(raw: unknown): number[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function createApp(db: Db) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  const auth = createAuth(process.env.MEAL_PICKER_PASSWORD);
  app.use("/api/auth", auth.router);

  // Final access model (Mike, 2026-10-20):
  // - Open: meal/tag reads and the randomizer (including POST /api/pick).
  // - Login required: every mutation, plus the calendar and its derived
  //   shopping list. /api/library is gated too because it aggregates plans
  //   and shopping. To change the shopping-list rule, edit this one list.
  const LOGIN_REQUIRED_READ_PATHS = new Set(["/library", "/plans", "/shopping"]);
  const OPEN_MUTATION_ROUTES = new Set(["POST /pick"]);
  app.use("/api", (req, res, next) => {
    const path = new URL(req.originalUrl, "http://meal-picker.local").pathname.replace(/^\/api/, "");
    const route = `${req.method} ${path}`;
    if (req.method === "GET" && LOGIN_REQUIRED_READ_PATHS.has(path)) {
      return auth.requireAuth(req, res, next);
    }
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      !OPEN_MUTATION_ROUTES.has(route)
    ) {
      return auth.requireAuth(req, res, next);
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, auth_enabled: auth.enabled });
  });

  // Convenience aggregate mirroring the old listLibrary action. It includes
  // plans and shopping, so the access middleware above requires login.
  app.get("/api/library", (_req, res) => {
    res.json({
      tags: listTagRows(db).map((tag) => ({ id: tag.id, name: tag.name })),
      meals: listMealResponses(db),
      plans: listPlanResponses(db),
      shopping: buildShoppingList(db),
    });
  });

  // ---- Meals ---------------------------------------------------------------
  app.get("/api/meals", (req, res) => {
    const tagIds = parseTagIds(req.query.tagIds);
    const includeHidden = req.query.includeHidden === "true";
    let meals = listMealResponses(db);
    if (!includeHidden) meals = meals.filter((meal) => !meal.hidden);
    if (tagIds.length > 0) {
      meals = meals.filter((meal) => tagIds.every((tagId) => meal.tag_ids.includes(tagId)));
    }
    res.json({ meals });
  });

  app.get("/api/meals/:id", (req, res) => {
    const id = idParam.safeParse(req.params.id);
    const meal = id.success ? getMealResponse(db, id.data) : null;
    if (!meal) return res.status(404).json({ error: "Meal not found." });
    res.json({ meal });
  });

  app.post("/api/meals", (req, res) => {
    const body = mealBody.parse(req.body);
    const newId = saveMeal(db, body);
    res.status(201).json({ ok: true, id: newId });
  });

  app.put("/api/meals/:id", (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = mealBody.parse(req.body);
    saveMeal(db, body, id);
    res.json({ ok: true, id });
  });

  app.delete("/api/meals/:id", (req, res) => {
    const id = idParam.parse(req.params.id);
    db.delete(schema.meals).where(eq(schema.meals.id, id)).run();
    res.json({ ok: true });
  });

  // Hide / unhide (body: { hidden: true|false })
  app.post("/api/meals/:id/hidden", (req, res) => {
    const id = idParam.parse(req.params.id);
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
    const existing = db.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.id, id)).all();
    if (!existing[0]) return res.status(404).json({ error: "Meal not found." });
    db.update(schema.meals).set({ hidden, updatedAt: new Date() }).where(eq(schema.meals.id, id)).run();
    res.json({ ok: true });
  });

  // Per-person rating update. Either field may be sent on its own; each value
  // must be an integer quarter unit 1..20 or null (clear the rating).
  app.patch("/api/meals/:id/ratings", (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({ mikesRating: rating.optional(), michellesRating: rating.optional() })
      .refine((b) => b.mikesRating !== undefined || b.michellesRating !== undefined, {
        message: "Provide at least one rating.",
      })
      .parse(req.body);
    const existing = db.select().from(schema.meals).where(eq(schema.meals.id, id)).all();
    if (!existing[0]) return res.status(404).json({ error: "That meal no longer exists." });
    db.update(schema.meals)
      .set({
        mikesRating: body.mikesRating !== undefined ? body.mikesRating : existing[0].mikesRating,
        michellesRating: body.michellesRating !== undefined ? body.michellesRating : existing[0].michellesRating,
        updatedAt: new Date(),
      })
      .where(eq(schema.meals.id, id))
      .run();
    res.json({ ok: true, meal: getMealResponse(db, id) });
  });

  // ---- Tags ----------------------------------------------------------------
  app.get("/api/tags", (_req, res) => {
    res.json({ tags: listTagRows(db).map((tag) => ({ id: tag.id, name: tag.name })) });
  });

  app.post("/api/tags", (req, res) => {
    const { name: rawName } = z.object({ name: z.string().min(1).max(40) }).parse(req.body);
    const name = normalizeTag(rawName);
    if (!name) return res.status(400).json({ error: "Enter a tag name." });
    const existing = db.select().from(schema.tags).where(eq(schema.tags.name, name)).all();
    if (existing[0]) return res.json({ id: existing[0].id, name: existing[0].name });
    const inserted = db.insert(schema.tags).values({ name }).returning({ id: schema.tags.id, name: schema.tags.name }).get();
    if (!inserted) return res.status(500).json({ error: "The tag could not be added." });
    res.status(201).json(inserted);
  });

  app.delete("/api/tags/:id", (req, res) => {
    const id = idParam.parse(req.params.id);
    db.delete(schema.tags).where(eq(schema.tags.id, id)).run();
    res.json({ ok: true });
  });

  // Replace a meal's tag assignment (meal-tag assignment endpoint).
  app.put("/api/meals/:id/tags", (req, res) => {
    const id = idParam.parse(req.params.id);
    const { tagIds } = z.object({ tagIds: z.array(z.number().int().positive()).max(100) }).parse(req.body);
    const existing = db.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.id, id)).all();
    if (!existing[0]) return res.status(404).json({ error: "Meal not found." });
    const validIds = new Set(db.select({ id: schema.tags.id }).from(schema.tags).all().map((t) => t.id));
    const unique = [...new Set(tagIds)].filter((tagId) => validIds.has(tagId));
    db.transaction((tx) => {
      tx.delete(schema.mealTags).where(eq(schema.mealTags.mealId, id)).run();
      if (unique.length > 0) tx.insert(schema.mealTags).values(unique.map((tagId) => ({ mealId: id, tagId }))).run();
      tx.update(schema.meals).set({ updatedAt: new Date() }).where(eq(schema.meals.id, id)).run();
    });
    res.json({ ok: true, meal: getMealResponse(db, id) });
  });

  // ---- Weighted pick ---------------------------------------------------------
  app.post("/api/pick", (req, res) => {
    const body = z.object({ tagIds: z.array(z.number().int().positive()).max(100).default([]) }).parse(req.body ?? {});
    res.json(pickMeal(db, body.tagIds));
  });
  app.get("/api/pick", (req, res) => {
    res.json(pickMeal(db, parseTagIds(req.query.tagIds)));
  });

  // ---- Meal plans ------------------------------------------------------------
  app.get("/api/plans", (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (from) dateString.parse(from);
    if (to) dateString.parse(to);
    res.json({ plans: listPlanResponses(db, from, to) });
  });

  // Upsert by date (one meal per date), matching the old setMealPlan action.
  app.post("/api/plans", (req, res) => {
    const body = z.object({ planDate: dateString, mealId: z.number().int().positive() }).parse(req.body);
    const meal = db.select({ id: schema.meals.id }).from(schema.meals).where(eq(schema.meals.id, body.mealId)).all();
    if (!meal[0]) return res.status(400).json({ error: "Choose a meal that still exists." });
    const existing = db.select().from(schema.mealPlans).where(eq(schema.mealPlans.planDate, body.planDate)).all();
    const now = new Date();
    if (existing[0]) {
      db.update(schema.mealPlans)
        .set({ mealId: body.mealId, completedAt: null, updatedAt: now })
        .where(eq(schema.mealPlans.id, existing[0].id))
        .run();
      return res.json({ ok: true, id: existing[0].id });
    }
    const inserted = db
      .insert(schema.mealPlans)
      .values({ planDate: body.planDate, mealId: body.mealId, createdAt: now, updatedAt: now })
      .returning({ id: schema.mealPlans.id })
      .get();
    res.status(201).json({ ok: true, id: inserted?.id });
  });

  app.patch("/api/plans/:id/complete", (req, res) => {
    const id = idParam.parse(req.params.id);
    const { complete } = z.object({ complete: z.boolean() }).parse(req.body);
    const existing = db.select({ id: schema.mealPlans.id }).from(schema.mealPlans).where(eq(schema.mealPlans.id, id)).all();
    if (!existing[0]) return res.status(404).json({ error: "Plan not found." });
    db.update(schema.mealPlans)
      .set({ completedAt: complete ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.mealPlans.id, id))
      .run();
    res.json({ ok: true });
  });

  app.delete("/api/plans/:id", (req, res) => {
    const id = idParam.parse(req.params.id);
    db.delete(schema.mealPlans).where(eq(schema.mealPlans.id, id)).run();
    res.json({ ok: true });
  });

  // ---- Shopping list -----------------------------------------------------------
  app.get("/api/shopping", (_req, res) => {
    res.json({ shopping: buildShoppingList(db) });
  });

  // ---- Static placeholder (Phase 2 React app will replace public/) -------------
  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
  app.use(express.static(publicDir));

  // ---- Errors ------------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed.", issues: err.issues });
      return;
    }
    if (err instanceof Error && /no longer exists|not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  });

  return { app, authEnabled: auth.enabled };
}
