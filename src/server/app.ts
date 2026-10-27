import { Hono } from "hono";

import { type CatalogDatabase, registerCatalogRoutes } from "@/server/catalog";

// The database arrives through c.env.db (injected by the Next adapter or tests);
// this module imports no driver, so the Hono CLI can load it.
const app = new Hono<{ Bindings: { db?: CatalogDatabase } }>().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

registerCatalogRoutes(app);

export default app;
