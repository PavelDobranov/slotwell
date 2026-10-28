import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { bookingOperations } from "@/db/schema";
import { contactLimits } from "@/lib/guest-contact";
import {
  type BookingInput,
  bookingStartInstant,
} from "@/server/book-appointment";

type Database = Pick<NodePgDatabase, "transaction">;
type KeyRing = { currentId: string; keys: Record<string, Buffer> };
export type BookingKeys = { fingerprint: KeyRing; replay: KeyRing };
export type OperationCredential = { operationId: string; credential: string };
export class OperationError extends Error {
  constructor(
    readonly code:
      | "invalid_booking"
      | "operation_unavailable"
      | "payload_conflict"
      | "recovery_unavailable",
  ) {
    super(code);
  }
}

function text(value: unknown, max: number, trim = false): string {
  if (typeof value !== "string") throw new OperationError("invalid_booking");
  const result = trim ? value.trim() : value;
  if (result.length > max || (trim && !result))
    throw new OperationError("invalid_booking");
  return result;
}
function integer(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new OperationError("invalid_booking");
  return value as number;
}
/** Copy only fields that execute; never retain caller-owned objects across awaits. */
function snapshot(input: BookingInput): BookingInput {
  try {
    const startsAt = new Date(bookingStartInstant(input)).toISOString();
    const raw = input.contact as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error();
    const contact = {
      name: text(raw.name, contactLimits.name, true),
      phone: text(raw.phone, contactLimits.phone, true),
      email: text(raw.email, contactLimits.email, true),
      note: raw.note === undefined ? "" : text(raw.note, contactLimits.note),
      ...(raw.phoneCountry === undefined
        ? {}
        : { phoneCountry: text(raw.phoneCountry, 2) }),
    };
    if (
      !Array.isArray(input.reviewedServices) ||
      input.reviewedServices.length !== input.serviceIds.length
    )
      throw new Error();
    const reviewedServices = input.reviewedServices.map((service) => ({
      id: text(service.id, 64, true),
      name: text(service.name, 1000, true),
      priceCents:
        service.priceCents === null ? null : integer(service.priceCents, 0),
      currency: text(service.currency, 3),
      durationMinutes: integer(service.durationMinutes, 1),
      cleanupMinutes: integer(service.cleanupMinutes, 0),
    }));
    return {
      staffId: input.staffId,
      serviceIds: [...input.serviceIds],
      startsAt,
      reviewedServices,
      contact,
    };
  } catch {
    throw new OperationError("invalid_booking");
  }
}
function canonical(input: BookingInput): string {
  const contact = input.contact as Record<string, string>;
  return JSON.stringify([
    1,
    input.staffId,
    input.serviceIds,
    input.startsAt,
    input.reviewedServices.map((service) => [
      service.id,
      service.name,
      service.priceCents,
      service.currency,
      service.durationMinutes,
      service.cleanupMinutes,
    ]),
    contact.name,
    contact.phone,
    contact.email,
    contact.note,
    contact.phoneCountry ?? null,
  ]);
}
export function canonicalBookingPayload(input: BookingInput): string {
  return canonical(snapshot(input));
}
function now(clock: () => number): number {
  const value = clock();
  if (!Number.isFinite(value)) throw new OperationError("recovery_unavailable");
  return value;
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** Keys are supplied by trusted server configuration, never request data. */
export function createBookingOperations(configuration: BookingKeys) {
  const copyRing = (ring: KeyRing): KeyRing => {
    if (!ring || !Object.hasOwn(ring.keys, ring.currentId))
      throw new OperationError("recovery_unavailable");
    const keys: Record<string, Buffer> = Object.create(null);
    for (const [id, key] of Object.entries(ring.keys)) {
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        !Buffer.isBuffer(key) ||
        key.length !== 32
      )
        throw new OperationError("recovery_unavailable");
      keys[id] = Buffer.from(key);
    }
    return { currentId: ring.currentId, keys };
  };
  const fingerprint = copyRing(configuration.fingerprint);
  const replay = copyRing(configuration.replay);
  for (const hmacKey of Object.values(fingerprint.keys)) {
    if (Object.values(replay.keys).some((key) => key.equals(hmacKey)))
      throw new OperationError("recovery_unavailable");
  }
  return {
    async createIntent(
      db: Database,
      clock: () => number = Date.now,
    ): Promise<OperationCredential> {
      const credential = randomBytes(32);
      const operationId = randomUUID();
      const created = now(clock);
      try {
        await db.transaction(async (tx) => {
          await tx.insert(bookingOperations).values({
            id: operationId,
            credentialHash: hash(credential),
            state: "pending",
            createdAt: new Date(created).toISOString(),
            submitBefore: new Date(created + 86_400_000).toISOString(),
          });
        });
      } catch {
        throw new OperationError("recovery_unavailable");
      }
      return { operationId, credential: credential.toString("hex") };
    },
  };
}
