import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Hono } from "hono";

import {
  BookingError,
  type BookingInput,
  OperationError,
  submitBooking,
} from "@/server/booking";
import {
  type BookingConfiguration,
  readBookingConfiguration,
} from "@/server/booking-configuration";
import { MAX_SELECTED_SERVICES } from "@/server/catalog";

export type BookingDatabase = Pick<NodePgDatabase, "transaction">;
class InputError extends Error {
  constructor(readonly code: "invalid_booking" | "request_too_large") {
    super(code);
  }
}
function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("invalid_booking");
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new InputError("invalid_booking");
  return record;
}
function parseInput(value: unknown) {
  const body = object(value, ["operationId", "credential", "booking"]);
  if (
    typeof body.operationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      body.operationId,
    ) ||
    typeof body.credential !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.credential)
  )
    throw new InputError("invalid_booking");
  const booking = object(body.booking, [
    "staffId",
    "serviceIds",
    "startsAt",
    "reviewedServices",
    "contact",
  ]);
  if (
    !Array.isArray(booking.serviceIds) ||
    booking.serviceIds.length > MAX_SELECTED_SERVICES ||
    !Array.isArray(booking.reviewedServices) ||
    booking.reviewedServices.length > MAX_SELECTED_SERVICES
  )
    throw new InputError("invalid_booking");
  object(booking.contact, ["name", "phone", "email"], ["note", "phoneCountry"]);
  for (const service of booking.reviewedServices)
    object(service, [
      "id",
      "name",
      "priceCents",
      "currency",
      "durationMinutes",
      "cleanupMinutes",
    ]);
  // Structural/transport shape only. The use case runs canonical business
  // validation (and rejects invalid input before registering an intent).
  return {
    authorization: {
      operationId: body.operationId,
      credential: body.credential,
    },
    input: booking as BookingInput,
  };
}
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("invalid_booking");
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel().catch(() => {});
        throw new InputError("request_too_large");
      }
      chunks.push(value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("invalid_booking");
  } finally {
    reader.releaseLock();
  }
}

export function registerBookingRoutes<Database extends BookingDatabase>(
  app: Hono<{ Bindings: { db?: Database } }>,
  options: {
    configuration?: () => BookingConfiguration;
    clock?: () => number;
  } = {},
) {
  app.post("/bookings", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    try {
      const configuration = options.configuration
        ? options.configuration()
        : readBookingConfiguration(process.env);
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
      const { authorization, input } = parseInput(await readBody(c.req.raw));
      const db = c.env?.db;
      if (!db) throw new Error();
      const receipt = await submitBooking(
        db,
        { authorization, input },
        { keys: configuration.keys, clock: options.clock },
      );
      return c.json({
        appointmentId: receipt.appointmentId,
        confirmationExpiresAt: receipt.confirmationExpiresAt,
        viewToken: receipt.viewToken,
      });
    } catch (error) {
      if (error instanceof InputError)
        return c.json(
          { error: { code: error.code } },
          error.code === "request_too_large" ? 413 : 400,
        );
      if (error instanceof BookingError || error instanceof OperationError) {
        if (
          error.code === "invalid_booking" ||
          error.code === "invalid_contact"
        )
          return c.json({ error: { code: error.code } }, 400);
        if (
          error.code !== "booking_busy" &&
          error.code !== "recovery_unavailable"
        )
          return c.json({ error: { code: error.code } }, 409);
        return c.json({ error: { code: error.code, outcome: "unknown" } }, 503);
      }
      // Includes configuration/driver failures. Never log request, receipt or raw error/cause.
      return c.json(
        { error: { code: "recovery_unavailable", outcome: "unknown" } },
        503,
      );
    }
  });
}
