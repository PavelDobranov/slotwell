import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  bookingOperations,
  businessSettings,
  clients,
  services,
  staff,
  staffOccupancy,
} from "@/db/schema";
import { type AvailabilityView, readAvailability } from "@/server/availability";
import { CatalogError } from "@/server/catalog";
import { addCalendarDays, businessDate } from "@/shared/booking-time";
import { parseGuestContact } from "@/shared/guest-contact";
import { validateServiceSelection } from "@/shared/service-selection";

export type ReviewedService = Pick<
  typeof services.$inferSelect,
  | "id"
  | "name"
  | "priceCents"
  | "currency"
  | "durationMinutes"
  | "cleanupMinutes"
>;
export type BookingInput = {
  staffId: string;
  serviceIds: string[];
  startsAt: string;
  reviewedServices: ReviewedService[];
  contact: unknown;
};
type RecoveryFields = Pick<
  typeof bookingOperations.$inferSelect,
  | "payloadFingerprint"
  | "fingerprintVersion"
  | "fingerprintKeyId"
  | "encryptedReplay"
  | "replayKeyId"
>;
type RecoveryMaterial = {
  [Key in keyof RecoveryFields]: NonNullable<RecoveryFields[Key]>;
} & { tokenHash: string };
/** Trusted server collaborator, NOT request data. #70 owns canonicalization,
 * crypto/key custody and replay. prepare is synchronous and side-effect-free. */
export type BookingRecovery = {
  operationId: string;
  credentialHash: string;
  prepare: (booking: {
    appointmentId: string;
    confirmationExpiresAt: string;
  }) => RecoveryMaterial;
};
export class BookingError extends Error {
  constructor(
    readonly code:
      | "invalid_booking"
      | "invalid_contact"
      | "review_required"
      | "selection_unavailable"
      | "availability_conflict"
      | "operation_unavailable"
      | "booking_busy",
  ) {
    super(code);
  }
}

export function bookingStartInstant(input: BookingInput): number {
  try {
    validateServiceSelection(input.serviceIds);
    if (!input.staffId.trim() || input.staffId.length > 64) throw new Error();
    // Strict minute-precision ISO with an explicit offset; Date.parse alone
    // accepts machine-local strings and rolls invalid dates into another month.
    if (
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00(?:\.000)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
        input.startsAt,
      )
    )
      throw new Error();
    addCalendarDays(input.startsAt.slice(0, 10), 0);
    const instant = Date.parse(input.startsAt);
    if (!Number.isFinite(instant) || input.startsAt.startsWith("0000"))
      throw new Error();
    return instant;
  } catch {
    throw new BookingError("invalid_booking");
  }
}

/** Lock protocol: operation UPDATE -> business SHARE -> staff UPDATE -> services
 * SHARE in ID order. Configuration writers must lock these parents BEFORE child
 * mutations (including schedules, exceptions, qualifications and seeded blocks).
 * Service-only writers must not subsequently acquire earlier-order locks.
 * The GiST exclusion remains the overlap invariant even for direct SQL writers.
 * No HTTP exposure: #70 must verify fingerprint/decrypt already_committed before
 * replay; it is NOT evidence of failure or permission to create a fresh intent. */
export async function bookAppointment(
  db: Pick<NodePgDatabase, "transaction">,
  input: BookingInput,
  recovery: BookingRecovery,
  clock: () => number = Date.now,
) {
  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        const [operation] = await tx
          .select()
          .from(bookingOperations)
          .where(
            and(
              eq(bookingOperations.id, recovery.operationId),
              eq(bookingOperations.credentialHash, recovery.credentialHash),
            ),
          )
          .for("update");
        if (!operation) throw new BookingError("operation_unavailable");
        if (operation.state === "committed")
          return { kind: "already_committed" as const, operation };
        if (operation.state !== "pending")
          throw new BookingError("operation_unavailable");
        const start = bookingStartInstant(input);
        const [business] = await tx
          .select()
          .from(businessSettings)
          .where(eq(businessSettings.id, 1))
          .for("share");
        if (!business) throw new Error("Booking configuration unavailable");
        const [member] = await tx
          .select()
          .from(staff)
          .where(eq(staff.id, input.staffId))
          .for("update");
        const selected = await tx
          .select()
          .from(services)
          .where(inArray(services.id, input.serviceIds))
          .orderBy(services.id)
          .for("share");
        if (
          !member?.isActive ||
          selected.length !== input.serviceIds.length ||
          selected.some((service) => !service.isActive)
        )
          throw new BookingError("selection_unavailable");
        const ordered = input.serviceIds.map((id) => {
          const service = selected.find((row) => row.id === id);
          if (!service) throw new BookingError("selection_unavailable");
          return service;
        });
        const fields = [
          "id",
          "name",
          "priceCents",
          "currency",
          "durationMinutes",
          "cleanupMinutes",
        ] as const;
        if (
          input.reviewedServices.length !== ordered.length ||
          ordered.some((service, index) =>
            fields.some(
              (key) => service[key] !== input.reviewedServices[index]?.[key],
            ),
          )
        )
          throw new BookingError("review_required");
        if (ordered.some((service) => service.currency !== business.currency))
          throw new Error("Invalid booking currency configuration");
        const parsed = parseGuestContact(
          input.contact,
          business.defaultPhoneCountry,
        );
        if (!parsed.success) throw new BookingError("invalid_contact");
        const contact = parsed.contact;
        // Separate statements at READ COMMITTED: a concurrent winner becomes
        // visible to SELECT after ON CONFLICT waits. Never update a client profile.
        await tx
          .insert(clients)
          .values({
            id: randomUUID(),
            normalizedPhone: contact.normalizedPhone,
          })
          .onConflictDoNothing({ target: clients.normalizedPhone });
        const [client] = await tx
          .select()
          .from(clients)
          .where(eq(clients.normalizedPhone, contact.normalizedPhone));
        if (!client) throw new Error("Client association unavailable");
        const durationMinutes = ordered.reduce(
          (sum, service) => sum + service.durationMinutes,
          0,
        );
        const cleanupMinutes = ordered.reduce(
          (sum, service) => sum + service.cleanupMinutes,
          0,
        );
        const serviceEnd = start + durationMinutes * 60_000;
        const occupiedEnd = serviceEnd + cleanupMinutes * 60_000;
        const appointmentId = randomUUID();
        const confirmationExpiresAt = new Date(
          serviceEnd + 168 * 3_600_000,
        ).toISOString();
        const material = recovery.prepare({
          appointmentId,
          confirmationExpiresAt,
        });
        const date = businessDate(start, business.timeZone);
        let availability: AvailabilityView;
        try {
          availability = await readAvailability(
            tx,
            {
              staffId: input.staffId,
              serviceIds: input.serviceIds,
              from: date,
              to: date,
            },
            clock(),
          );
        } catch (error) {
          // A selection the catalog cannot satisfy (unknown service or staff) is
          // a client problem; infrastructure failures (availability_unavailable)
          // propagate. The application keys off the code, not an HTTP status.
          if (
            error instanceof CatalogError &&
            (error.code === "unknown_services" ||
              error.code === "unknown_staff")
          )
            throw new BookingError("selection_unavailable");
          throw error;
        }
        if (
          !availability.days[0]?.slots.some(
            (slot) => Date.parse(slot.start) === start,
          )
        )
          throw new BookingError("availability_conflict");
        // Acceptance instant: re-sample AFTER asynchronous authoritative reads and
        // client/parent lock waits, not transaction-start time or the caller's clock.
        const now = clock();
        if (!Number.isFinite(now)) throw new Error("Invalid booking clock");
        if (now >= Date.parse(operation.submitBefore))
          throw new BookingError("operation_unavailable");
        const today = businessDate(now, business.timeZone);
        if (
          start < now + business.leadTimeMinutes * 60_000 ||
          date < today ||
          date > addCalendarDays(today, business.horizonDays)
        )
          throw new BookingError("availability_conflict");
        await tx.insert(appointments).values({
          id: appointmentId,
          clientId: client.id,
          staffId: member.id,
          contactName: contact.name,
          contactPhone: contact.phone,
          contactEmail: contact.email,
          notes: contact.note || null,
          staffName: member.name,
          businessAddress: business.address,
          bookingTimeZone: business.timeZone,
          startsAt: new Date(start).toISOString(),
          serviceEndsAt: new Date(serviceEnd).toISOString(),
          occupiedEndsAt: new Date(occupiedEnd).toISOString(),
          createdAt: new Date(now).toISOString(),
          confirmationExpiresAt,
        });
        await tx.insert(appointmentServices).values(
          ordered.map((service, position) => ({
            appointmentId,
            position,
            serviceId: service.id,
            name: service.name,
            priceCents: service.priceCents,
            currency: service.currency,
            durationMinutes: service.durationMinutes,
            cleanupMinutes: service.cleanupMinutes,
          })),
        );
        await tx.insert(staffOccupancy).values({
          staffId: member.id,
          appointmentId,
          kind: "appointment",
          period: sql`tstzrange(${new Date(start).toISOString()}::timestamptz, ${new Date(occupiedEnd).toISOString()}::timestamptz, '[)')`,
        });
        await tx
          .insert(appointmentAccess)
          .values({ appointmentId, tokenHash: material.tokenHash });
        await tx
          .update(bookingOperations)
          .set({
            state: "committed",
            appointmentId,
            payloadFingerprint: material.payloadFingerprint,
            fingerprintVersion: material.fingerprintVersion,
            fingerprintKeyId: material.fingerprintKeyId,
            encryptedReplay: material.encryptedReplay,
            replayKeyId: material.replayKeyId,
            replayExpiresAt: confirmationExpiresAt,
          })
          .where(eq(bookingOperations.id, operation.id));
        const totalPriceCents = ordered.some(
          (service) => service.priceCents === null,
        )
          ? null
          : ordered.reduce(
              (sum, service) => sum + (service.priceCents ?? 0),
              0,
            );
        return {
          kind: "created" as const,
          appointmentId,
          confirmationExpiresAt,
          durationMinutes,
          cleanupMinutes,
          totalPriceCents,
          currency: business.currency,
        };
      },
      { isolationLevel: "read committed" },
    );
  } catch (error) {
    // Drizzle wraps pg errors. Translate only named overlap/transaction conflicts;
    // never catch inside the transaction and accidentally commit partial writes.
    let cause: unknown = error;
    while (cause && typeof cause === "object") {
      const pg = cause as {
        code?: string;
        constraint?: string;
        cause?: unknown;
      };
      if (pg.code === "23P01" && pg.constraint === "staff_occupancy_no_overlap")
        throw new BookingError("availability_conflict");
      if (["55P03", "40P01", "40001"].includes(pg.code ?? ""))
        throw new BookingError("booking_busy");
      cause = pg.cause;
    }
    throw error;
  }
}
