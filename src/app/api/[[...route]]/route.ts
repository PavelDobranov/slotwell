import { getDatabase } from "@/db";
import app from "@/server/app";

// Inject the lazy server-only database; Hono owns validation and booking behavior.
export function GET(request: Request) {
  return app.fetch(request, { db: getDatabase() });
}

export function POST(request: Request) {
  let db: ReturnType<typeof getDatabase> | undefined;
  try {
    db = getDatabase();
  } catch {
    // Let Hono return its private generic unavailable response without a binding.
  }
  return app.fetch(request, { db });
}
