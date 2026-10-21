import { createApp } from "./app.js";
import { openDb } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);
const { db, path } = openDb();
const { app, authEnabled } = createApp(db);

if (!authEnabled) {
  console.warn(
    "[meal-picker] WARNING: MEAL_PICKER_PASSWORD is not set — auth is DISABLED (local dev mode). All endpoints are open.",
  );
} else {
  console.log("[meal-picker] Auth enabled: mutations and calendar/shopping reads require login; meal reads and the randomizer are open.");
}

app.listen(port, () => {
  console.log(`[meal-picker] Listening on http://localhost:${port} (db: ${path})`);
});
