import { getDatabase } from "@/db";
import app from "@/server/app";

// Inject the lazy server-only app database as a Hono binding; the app module
// itself stays driver-free so the Hono CLI can load it.
export function GET(request: Request) {
  return app.fetch(request, { db: getDatabase() });
}
