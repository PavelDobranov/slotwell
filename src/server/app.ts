import { Hono } from "hono";

import type { CatalogDatabase } from "@/server/catalog";
import { registerAvailabilityRoutes } from "@/server/http/availability.routes";
import {
  type BookingDatabase,
  registerBookingRoutes,
} from "@/server/http/booking.routes";
import { registerCatalogRoutes } from "@/server/http/catalog.routes";

// Bindings are injected by the Next adapter or tests; importing the app opens no database.
const app = new Hono<{
  Bindings: { db?: CatalogDatabase & BookingDatabase };
}>().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

// Mount read routes with their narrower database contract unchanged.
const reads = new Hono<{ Bindings: { db?: CatalogDatabase } }>();
registerCatalogRoutes(reads);
registerAvailabilityRoutes(reads);
app.route("/", reads);
registerBookingRoutes(app);

export default app;
