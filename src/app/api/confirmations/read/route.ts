import { getDatabase } from "@/db";
import app from "@/server/app";

// Hono owns all transport/authorization decisions, including private method rejection.
export function POST(request: Request) {
  let db: ReturnType<typeof getDatabase> | undefined;
  try {
    db = getDatabase();
  } catch {
    // Missing configuration must reach Hono's redacted private 503 response.
  }
  return app.fetch(request, { db });
}

// Explicit exports prevent Next's automatic OPTIONS/HEAD handling from bypassing
// the confirmation adapter. Method rejection does not need a database connection.
export function GET(request: Request) {
  return app.fetch(request);
}
export { GET as HEAD, GET as OPTIONS, GET as PUT, GET as PATCH, GET as DELETE };
