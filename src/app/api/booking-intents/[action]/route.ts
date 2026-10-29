import { getDatabase } from "@/db";
import app from "@/server/app";

// Hono owns the two lifecycle actions, validation and private response policy.
export function POST(request: Request) {
  let db: ReturnType<typeof getDatabase> | undefined;
  try {
    db = getDatabase();
  } catch {
    // Setup failures reach Hono's redacted unknown-outcome response.
  }
  return app.fetch(request, { db });
}

// Explicit dispatch prevents automatic Next OPTIONS/HEAD from bypassing privacy.
export function GET(request: Request) {
  return app.fetch(request);
}
export { GET as HEAD, GET as OPTIONS, GET as PUT, GET as PATCH, GET as DELETE };
