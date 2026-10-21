// ---------------------------------------------------------------------------
// Auth — isolated, removable module.
//
// Design (deliberately minimal; confirmed by Mike 2026-10-20 as the final
// v1 auth model — a single shared household password, no user accounts):
//  - One shared password, read from the MEAL_PICKER_PASSWORD env var.
//  - POST /api/auth/login { password } sets an httpOnly session cookie whose
//    value is an HMAC of a fixed label keyed by the password itself, so no
//    server-side session store is needed and no secret is stored in code.
//  - The `requireAuth` middleware guards mutating endpoints and the
//    plan-derived read endpoints configured in app.ts (calendar + shopping).
//  - If MEAL_PICKER_PASSWORD is unset, auth is DISABLED (local dev mode):
//    requireAuth becomes a no-op and the server logs that clearly at startup.
//
// To remove auth entirely: delete this file, drop the `app.use(...)` line and
// the auth router mount in app.ts. Nothing else references it.
// ---------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";

export const SESSION_COOKIE = "mp_session";

function sessionToken(password: string): string {
  return createHmac("sha256", password).update("meal-picker-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export interface Auth {
  enabled: boolean;
  router: Router;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
}

export function createAuth(password: string | undefined): Auth {
  const enabled = Boolean(password);
  const router = Router();

  const isAuthed = (req: Request): boolean => {
    if (!enabled) return true;
    const token = parseCookies(req)[SESSION_COOKIE];
    return token !== undefined && safeEqual(token, sessionToken(password!));
  };

  router.get("/status", (req, res) => {
    res.json({ auth_enabled: enabled, authenticated: isAuthed(req) });
  });

  router.post("/login", (req, res) => {
    if (!enabled) {
      res.json({ ok: true, auth_enabled: false });
      return;
    }
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(supplied, password!)) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }
    res.cookie(SESSION_COOKIE, sessionToken(password!), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      // secure cookies require HTTPS; Caddy terminates TLS in production.
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ ok: true, auth_enabled: true });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || isAuthed(req)) {
      next();
      return;
    }
    res.status(401).json({ error: "Authentication required." });
  };

  return { enabled, router, requireAuth };
}
