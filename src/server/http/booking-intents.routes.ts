import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Hono } from "hono";

import {
  type BookingKeys,
  clearBookingIntent,
  OperationError,
  readBookingKeys,
  resolveBookingIntent,
} from "@/server/booking";
import { readBookingTransport } from "@/server/http/booking-configuration";

class InputError extends Error {
  constructor(readonly code: "invalid_booking" | "request_too_large") {
    super(code);
  }
}
async function readPair(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("invalid_booking");
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel().catch(() => {});
        throw new InputError("request_too_large");
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    const pair = body as Record<string, unknown>;
    if (
      Object.keys(pair).length !== 2 ||
      typeof pair.operationId !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(pair.operationId) ||
      typeof pair.credential !== "string" ||
      !/^[a-f0-9]{64}$/.test(pair.credential)
    )
      throw new Error();
    return { operationId: pair.operationId, credential: pair.credential };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("invalid_booking");
  } finally {
    reader.releaseLock();
  }
}

export function registerBookingIntentRoutes<
  Database extends Pick<NodePgDatabase, "transaction">,
>(
  app: Hono<{ Bindings: { db?: Database } }>,
  options: {
    configuration?: () => { origin: string; keys: BookingKeys };
    clock?: () => number;
  } = {},
) {
  for (const [action, execute] of [
    ["resolve", resolveBookingIntent],
    ["clear", clearBookingIntent],
  ] as const) {
    app.all(`/booking-intents/${action}`, async (c) => {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      c.header("X-Content-Type-Options", "nosniff");
      if (c.req.method !== "POST") {
        c.header("Allow", "POST");
        return c.req.method === "HEAD"
          ? c.body(null, 405)
          : c.json({ error: { code: "method_not_allowed" } }, 405);
      }
      try {
        const configuration = options.configuration
          ? options.configuration()
          : {
              origin: readBookingTransport(process.env).origin,
              keys: readBookingKeys(process.env),
            };
        const site = c.req.header("sec-fetch-site");
        if (
          c.req.header("origin") !== configuration.origin ||
          (site !== undefined && site !== "same-origin")
        )
          return c.json({ error: { code: "origin_forbidden" } }, 403);
        if (new URL(c.req.url).search) throw new InputError("invalid_booking");
        if (
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            c.req.header("content-type") ?? "",
          ) ||
          ![undefined, "identity"].includes(c.req.header("content-encoding"))
        )
          return c.json({ error: { code: "unsupported_media_type" } }, 415);
        const pair = await readPair(c.req.raw);
        return c.json(
          await execute(c.env?.db, pair, {
            keys: configuration.keys,
            clock: options.clock,
          }),
        );
      } catch (error) {
        if (error instanceof InputError)
          return c.json(
            { error: { code: error.code } },
            error.code === "request_too_large" ? 413 : 400,
          );
        if (
          error instanceof OperationError &&
          error.code === "operation_unavailable"
        )
          return c.json({ error: { code: error.code } }, 409);
        // No logging of bodies, credentials, receipts, SQL binds or raw exceptions.
        return c.json(
          { error: { code: "recovery_unavailable", outcome: "unknown" } },
          503,
        );
      }
    });
  }
}
