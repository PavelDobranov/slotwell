import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Hono } from "hono";

import { ConfirmationError, readConfirmation } from "@/server/booking";
import { readBookingTransport } from "@/server/http/booking-configuration";

class InputError extends Error {
  constructor(readonly code: "invalid_confirmation" | "request_too_large") {
    super(code);
  }
}
async function readInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("invalid_confirmation");
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
    const record = body as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.appointmentId !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
        record.appointmentId,
      ) ||
      typeof record.viewToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.viewToken)
    )
      throw new Error();
    return { appointmentId: record.appointmentId, viewToken: record.viewToken };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("invalid_confirmation");
  } finally {
    reader.releaseLock();
  }
}

export function registerConfirmationRoutes<
  Database extends Pick<NodePgDatabase, "select">,
>(
  app: Hono<{ Bindings: { db?: Database } }>,
  options: {
    configuration?: () => { origin: string };
    clock?: () => number;
  } = {},
) {
  app.all("/confirmations/read", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (c.req.method !== "POST") {
      c.header("Allow", "POST");
      return c.req.method === "HEAD"
        ? c.body(null, 405)
        : c.json({ error: { code: "method_not_allowed" } }, 405);
    }
    try {
      const configuration = options.configuration
        ? options.configuration()
        : readBookingTransport(process.env);
      const site = c.req.header("sec-fetch-site");
      if (
        c.req.header("origin") !== configuration.origin ||
        (site !== undefined && site !== "same-origin")
      )
        return c.json({ error: { code: "origin_forbidden" } }, 403);
      if (new URL(c.req.url).search)
        throw new InputError("invalid_confirmation");
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          c.req.header("content-type") ?? "",
        ) ||
        ![undefined, "identity"].includes(c.req.header("content-encoding"))
      )
        return c.json({ error: { code: "unsupported_media_type" } }, 415);
      const input = await readInput(c.req.raw);
      if (!c.env?.db) throw new Error();
      return c.json(await readConfirmation(c.env.db, input, options.clock));
    } catch (error) {
      if (error instanceof InputError)
        return c.json(
          { error: { code: error.code } },
          error.code === "request_too_large" ? 413 : 400,
        );
      if (
        error instanceof ConfirmationError &&
        error.code === "confirmation_unavailable"
      )
        return c.json({ error: { code: error.code } }, 404);
      // Never log bodies, credentials, returned snapshots, SQL binds or raw exceptions.
      return c.json(
        { error: { code: "confirmation_temporarily_unavailable" } },
        503,
      );
    }
  });
}
