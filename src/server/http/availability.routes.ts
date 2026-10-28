import type { Hono } from "hono";

import {
  type AvailabilityQuery,
  readAvailability,
} from "@/server/availability-query";
import { addCalendarDays } from "@/server/booking-time";
import {
  type CatalogDatabase,
  CatalogError,
  validateServiceSelection,
} from "@/server/catalog";

// Endpoint request bound: the widest public availability window. It guards the
// HTTP query, not the application read, so it lives with the adapter.
export const MAX_AVAILABILITY_DAYS = 7;

/** Strict public boundary: no client clock, duration, cleanup, price or eligibility. */
export function validateAvailabilityQuery(
  params: URLSearchParams,
): AvailabilityQuery {
  for (const key of params.keys()) {
    if (!["staff", "service", "from", "to"].includes(key))
      throw new CatalogError("invalid_query", 400);
  }
  const staffIds = params.getAll("staff");
  if (staffIds.length !== 1 || !staffIds[0].trim() || staffIds[0].length > 64)
    throw new CatalogError("invalid_staff_id", 400);
  const serviceIds = validateServiceSelection(params.getAll("service"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  try {
    if (params.getAll("from").length !== 1 || params.getAll("to").length !== 1)
      throw new RangeError();
    addCalendarDays(from, 0);
    addCalendarDays(to, 0);
    // PostgreSQL civil dates have no year zero; keep the public range four-digit AD.
    if (from.startsWith("0000") || to.startsWith("0000") || from > to)
      throw new RangeError();
  } catch {
    throw new CatalogError("invalid_date_range", 400);
  }
  if (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 >=
    MAX_AVAILABILITY_DAYS
  ) {
    throw new CatalogError("date_range_too_large", 400, {
      max: MAX_AVAILABILITY_DAYS,
    });
  }
  return { staffId: staffIds[0], serviceIds, from, to };
}

export function registerAvailabilityRoutes(
  app: Hono<{ Bindings: { db?: CatalogDatabase } }>,
) {
  app.get("/availability", async (c) => {
    c.header("Cache-Control", "no-store");
    const now = Date.now();
    try {
      const query = validateAvailabilityQuery(new URL(c.req.url).searchParams);
      if (!c.env?.db) throw new CatalogError("availability_unavailable", 500);
      return c.json(await readAvailability(c.env.db, query, now));
    } catch (error) {
      if (error instanceof CatalogError)
        return c.json(error.body(), error.status as 400 | 500);
      return c.json({ error: { code: "internal" } }, 500);
    }
  });
}
