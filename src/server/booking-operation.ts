import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointments,
  bookingOperations,
} from "@/db/schema";
import {
  BookingError,
  type BookingInput,
  bookAppointment,
  bookingStartInstant,
} from "@/server/book-appointment";
import { contactLimits } from "@/shared/guest-contact";

type Database = Pick<NodePgDatabase, "transaction">;
type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
type Operation = typeof bookingOperations.$inferSelect;
export type BookingReceipt = {
  appointmentId: string;
  confirmationExpiresAt: string;
  viewToken: string;
};
export type IntentResolution =
  | { state: "pending"; submitBefore: string }
  | { state: "committed"; receipt: BookingReceipt };
export type IntentFence = { state: "fenced" } | { state: "committed" };
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
    const staffId = text(input.staffId, 64);
    if (!Array.isArray(input.serviceIds) || typeof input.startsAt !== "string")
      throw new Error();
    const serviceIds = input.serviceIds.map((id) => text(id, 64));
    const startsAt = new Date(
      bookingStartInstant({ ...input, staffId, serviceIds }),
    ).toISOString();
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
      id: text(service.id, 64),
      name: text(service.name, 1000),
      priceCents:
        service.priceCents === null ? null : integer(service.priceCents, 0),
      currency: text(service.currency, 3),
      durationMinutes: integer(service.durationMinutes, 1),
      cleanupMinutes: integer(service.cleanupMinutes, 0),
    }));
    return {
      staffId,
      serviceIds,
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

function credentialHash(credential: OperationCredential): string {
  if (
    typeof credential.operationId !== "string" ||
    typeof credential.credential !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      credential.operationId,
    ) ||
    !/^[a-f0-9]{64}$/.test(credential.credential)
  )
    throw new OperationError("operation_unavailable");
  return hash(Buffer.from(credential.credential, "hex"));
}
async function guarded<T>(
  db: Database,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return action(tx);
    });
  } catch (error) {
    if (error instanceof OperationError || error instanceof BookingError)
      throw error;
    // Drizzle errors can contain SQL bind values. Do not attach their cause.
    throw new OperationError("recovery_unavailable");
  }
}
async function lockOperation(tx: Transaction, credential: OperationCredential) {
  const digest = credentialHash(credential);
  const [operation] = await tx
    .select()
    .from(bookingOperations)
    .where(
      and(
        eq(bookingOperations.id, credential.operationId),
        eq(bookingOperations.credentialHash, digest),
      ),
    )
    .for("update");
  if (!operation) throw new OperationError("operation_unavailable");
  return operation;
}
const aad = (operationId: string, appointmentId: string, expiry: string) =>
  Buffer.from(
    JSON.stringify([
      1,
      operationId,
      appointmentId,
      new Date(expiry).toISOString(),
    ]),
  );

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
  const fingerprintFor = (payload: string, id: string) => {
    const key = fingerprint.keys[id];
    if (!key) throw new OperationError("recovery_unavailable");
    return createHmac("sha256", key).update(payload).digest("hex");
  };
  async function receipt(
    tx: Transaction,
    operation: Operation,
    clock: () => number,
    payload?: string,
  ): Promise<BookingReceipt> {
    if (
      operation.state !== "committed" ||
      !operation.appointmentId ||
      !operation.replayExpiresAt ||
      !operation.encryptedReplay ||
      !operation.replayKeyId ||
      !operation.fingerprintKeyId ||
      !operation.payloadFingerprint ||
      operation.fingerprintVersion !== 1
    )
      throw new OperationError("operation_unavailable");
    const [booking] = await tx
      .select({
        expiry: appointments.confirmationExpiresAt,
        tokenHash: appointmentAccess.tokenHash,
      })
      .from(appointments)
      .innerJoin(
        appointmentAccess,
        eq(appointments.id, appointmentAccess.appointmentId),
      )
      .where(eq(appointments.id, operation.appointmentId));
    if (
      !booking ||
      Date.parse(booking.expiry) !== Date.parse(operation.replayExpiresAt)
    )
      throw new OperationError("recovery_unavailable");
    if (now(clock) >= Date.parse(booking.expiry))
      throw new OperationError("operation_unavailable");
    // Recovery also requires the stored fingerprint key to remain available.
    const expected = fingerprintFor(payload ?? "", operation.fingerprintKeyId);
    if (
      payload !== undefined &&
      !timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(operation.payloadFingerprint, "hex"),
      )
    )
      throw new OperationError("payload_conflict");
    const key = replay.keys[operation.replayKeyId];
    if (!key) throw new OperationError("recovery_unavailable");
    const envelope = Buffer.from(operation.encryptedReplay, "hex");
    if (envelope.length !== 60)
      throw new OperationError("recovery_unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      envelope.subarray(0, 12),
    );
    decipher.setAAD(aad(operation.id, operation.appointmentId, booking.expiry));
    decipher.setAuthTag(envelope.subarray(44));
    const token = Buffer.concat([
      decipher.update(envelope.subarray(12, 44)),
      decipher.final(),
    ]);
    if (hash(token) !== booking.tokenHash)
      throw new OperationError("recovery_unavailable");
    if (now(clock) >= Date.parse(booking.expiry))
      throw new OperationError("operation_unavailable");
    return {
      appointmentId: operation.appointmentId,
      confirmationExpiresAt: new Date(booking.expiry).toISOString(),
      viewToken: token.toString("hex"),
    };
  }
  return {
    /** Trusted maintenance only; never a guest reset/delete endpoint. */
    async pruneExpired(
      db: Database,
      operationId: string,
      clock: () => number = Date.now,
    ): Promise<boolean> {
      return guarded(db, async (tx) => {
        const [operation] = await tx
          .select()
          .from(bookingOperations)
          .where(eq(bookingOperations.id, operationId))
          .for("update");
        if (
          !operation ||
          (operation.state !== "pending" && operation.state !== "committed")
        )
          return false;
        let expiry = Date.parse(operation.submitBefore);
        if (operation.state === "committed") {
          if (!operation.appointmentId || !operation.replayExpiresAt)
            throw new OperationError("recovery_unavailable");
          const [appointment] = await tx
            .select({ expiry: appointments.confirmationExpiresAt })
            .from(appointments)
            .where(eq(appointments.id, operation.appointmentId));
          if (
            !appointment ||
            Date.parse(appointment.expiry) !==
              Date.parse(operation.replayExpiresAt)
          )
            throw new OperationError("recovery_unavailable");
          expiry = Date.parse(appointment.expiry);
        }
        if (now(clock) < expiry) return false;
        if (operation.appointmentId)
          await tx
            .delete(appointmentAccess)
            .where(
              eq(appointmentAccess.appointmentId, operation.appointmentId),
            );
        await tx
          .update(bookingOperations)
          .set({
            state: "tombstone",
            appointmentId: null,
            payloadFingerprint: null,
            fingerprintVersion: null,
            fingerprintKeyId: null,
            encryptedReplay: null,
            replayKeyId: null,
            replayExpiresAt: null,
          })
          .where(eq(bookingOperations.id, operation.id));
        return true;
      });
    },
    async submit(
      db: Database,
      credential: OperationCredential,
      input: BookingInput,
      clock: () => number = Date.now,
    ): Promise<BookingReceipt> {
      const agreement = snapshot(input);
      const payload = canonical(agreement);
      const authorization = { ...credential };
      return guarded(db, async (tx) => {
        const before = await lockOperation(tx, authorization);
        if (
          before.state === "pending" &&
          now(clock) >= Date.parse(before.submitBefore)
        )
          throw new OperationError("operation_unavailable");
        const result = await bookAppointment(
          tx,
          agreement,
          {
            operationId: authorization.operationId,
            credentialHash: credentialHash(authorization),
            prepare: ({ appointmentId, confirmationExpiresAt }) => {
              const token = randomBytes(32);
              const nonce = randomBytes(12);
              const cipher = createCipheriv(
                "aes-256-gcm",
                replay.keys[replay.currentId],
                nonce,
              );
              cipher.setAAD(
                aad(
                  authorization.operationId,
                  appointmentId,
                  confirmationExpiresAt,
                ),
              );
              const ciphertext = Buffer.concat([
                cipher.update(token),
                cipher.final(),
              ]);
              return {
                tokenHash: hash(token),
                payloadFingerprint: fingerprintFor(
                  payload,
                  fingerprint.currentId,
                ),
                fingerprintVersion: 1,
                fingerprintKeyId: fingerprint.currentId,
                encryptedReplay: Buffer.concat([
                  nonce,
                  ciphertext,
                  cipher.getAuthTag(),
                ]).toString("hex"),
                replayKeyId: replay.currentId,
              };
            },
          },
          clock,
        );
        const operation =
          result.kind === "already_committed"
            ? result.operation
            : await lockOperation(tx, authorization);
        return receipt(tx, operation, clock, payload);
      });
    },
    /** Explicit noncommitted clear only. Must own the top-level transaction. */
    async fenceIntent(
      db: Database,
      credential: OperationCredential,
      clock: () => number = Date.now,
    ): Promise<IntentFence> {
      const authorization = {
        operationId: credential.operationId,
        credential: credential.credential,
      };
      const digest = credentialHash(authorization);
      // A savepoint acknowledgement could be undone by an outer rollback.
      if (!(db instanceof NodePgDatabase))
        throw new OperationError("recovery_unavailable");
      let createdAt: string;
      let submitBefore: string;
      try {
        const created = now(clock);
        createdAt = new Date(created).toISOString();
        submitBefore = new Date(created + 86_400_000).toISOString();
      } catch {
        throw new OperationError("recovery_unavailable");
      }
      return guarded(db, async (tx) => {
        // Even an unregistered pair needs a permanent fence against late registration.
        await tx
          .insert(bookingOperations)
          .values({
            id: authorization.operationId,
            credentialHash: digest,
            state: "abandoned",
            createdAt,
            submitBefore,
          })
          .onConflictDoNothing();
        const operation = await lockOperation(tx, authorization);
        now(clock);
        if (operation.state === "committed") return { state: "committed" };
        if (operation.state === "pending")
          await tx
            .update(bookingOperations)
            .set({ state: "abandoned" })
            .where(eq(bookingOperations.id, operation.id));
        return { state: "fenced" };
      });
    },
    /** A locked snapshot only; never permission to clear or replace an intent. */
    async resolveIntent(
      db: Database,
      credential: OperationCredential,
      clock: () => number = Date.now,
    ): Promise<IntentResolution> {
      const authorization = {
        operationId: credential.operationId,
        credential: credential.credential,
      };
      credentialHash(authorization);
      return guarded(db, async (tx) => {
        const operation = await lockOperation(tx, authorization);
        const instant = now(clock);
        if (operation.state === "pending") {
          if (instant >= Date.parse(operation.submitBefore))
            throw new OperationError("operation_unavailable");
          return {
            state: "pending",
            submitBefore: new Date(operation.submitBefore).toISOString(),
          };
        }
        return {
          state: "committed",
          receipt: await receipt(tx, operation, clock),
        };
      });
    },
    async recover(
      db: Database,
      credential: OperationCredential,
      clock: () => number = Date.now,
    ): Promise<BookingReceipt> {
      const authorization = { ...credential };
      return guarded(db, async (tx) =>
        receipt(tx, await lockOperation(tx, authorization), clock),
      );
    },
    /** Register a credential durably retained by the browser before networking. */
    async registerIntent(
      db: Database,
      credential: OperationCredential,
      clock: () => number = Date.now,
    ): Promise<void> {
      const authorization = { ...credential };
      const digest = credentialHash(authorization);
      const created = now(clock);
      await guarded(db, async (tx) => {
        await tx
          .insert(bookingOperations)
          .values({
            id: authorization.operationId,
            credentialHash: digest,
            state: "pending",
            createdAt: new Date(created).toISOString(),
            submitBefore: new Date(created + 86_400_000).toISOString(),
          })
          .onConflictDoNothing();
        // Neither uniqueness conflict may replace credentials or lifecycle data.
        await lockOperation(tx, authorization);
      });
    },
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
