import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
} from "@/db/schema";

export type ConfirmationCredential = {
  appointmentId: string;
  viewToken: string;
};
export type ConfirmationView = {
  status: "confirmed";
  startsAt: string;
  serviceEndsAt: string;
  bookingTimeZone: string;
  staffName: string;
  businessAddress: string;
  confirmationExpiresAt: string;
  services: {
    name: string;
    priceCents: number | null;
    currency: string;
    durationMinutes: number;
  }[];
};
export class ConfirmationError extends Error {
  constructor(
    readonly code:
      | "confirmation_unavailable"
      | "confirmation_temporarily_unavailable",
  ) {
    super(code);
  }
}

/** Read-only bearer access, independent from operation credentials and replay keys. */
export async function readConfirmation(
  db: Pick<NodePgDatabase, "select">,
  input: ConfirmationCredential,
  clock: () => number = Date.now,
): Promise<ConfirmationView> {
  try {
    if (
      !input ||
      typeof input.appointmentId !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
        input.appointmentId,
      ) ||
      typeof input.viewToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.viewToken)
    )
      throw new ConfirmationError("confirmation_unavailable");
    // Copy/hash before awaiting; never consult mutable caller input afterwards.
    const appointmentId = input.appointmentId;
    const tokenHash = createHash("sha256")
      .update(Buffer.from(input.viewToken, "hex"))
      .digest("hex");
    const rows = await db
      .select({
        status: appointments.status,
        startsAt: appointments.startsAt,
        serviceEndsAt: appointments.serviceEndsAt,
        bookingTimeZone: appointments.bookingTimeZone,
        staffName: appointments.staffName,
        businessAddress: appointments.businessAddress,
        confirmationExpiresAt: appointments.confirmationExpiresAt,
        position: appointmentServices.position,
        name: appointmentServices.name,
        priceCents: appointmentServices.priceCents,
        currency: appointmentServices.currency,
        durationMinutes: appointmentServices.durationMinutes,
      })
      .from(appointmentAccess)
      .innerJoin(
        appointments,
        eq(appointments.id, appointmentAccess.appointmentId),
      )
      .leftJoin(
        appointmentServices,
        eq(appointmentServices.appointmentId, appointments.id),
      )
      .where(
        and(
          eq(appointmentAccess.appointmentId, appointmentId),
          eq(appointmentAccess.tokenHash, tokenHash),
        ),
      )
      .orderBy(appointmentServices.position);
    const now = clock();
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime()))
      throw new Error();
    const first = rows[0];
    if (!first) throw new ConfirmationError("confirmation_unavailable");
    const startsAt = Date.parse(first.startsAt);
    const serviceEndsAt = Date.parse(first.serviceEndsAt);
    const expiry = Date.parse(first.confirmationExpiresAt);
    if (
      ![startsAt, serviceEndsAt, expiry].every(Number.isFinite) ||
      startsAt >= serviceEndsAt ||
      expiry !== serviceEndsAt + 168 * 3_600_000 ||
      first.status !== "confirmed"
    )
      throw new Error();
    // The schema checks only nonblank text; require a named, usable time zone.
    if (/^[+-]/.test(first.bookingTimeZone)) throw new Error();
    new Intl.DateTimeFormat("en", { timeZone: first.bookingTimeZone }).format(
      0,
    );
    const snapshots = rows.map((row, index) => {
      if (
        row.position !== index ||
        row.name === null ||
        row.currency === null ||
        row.durationMinutes === null ||
        row.currency !== first.currency
      )
        throw new Error();
      return {
        name: row.name,
        priceCents: row.priceCents,
        currency: row.currency,
        durationMinutes: row.durationMinutes,
      };
    });
    if (
      snapshots.reduce(
        (sum, service) => sum + service.durationMinutes * 60_000,
        0,
      ) !==
      serviceEndsAt - startsAt
    )
      throw new Error();
    if (now >= expiry) throw new ConfirmationError("confirmation_unavailable");
    return {
      status: "confirmed",
      startsAt: new Date(startsAt).toISOString(),
      serviceEndsAt: new Date(serviceEndsAt).toISOString(),
      bookingTimeZone: first.bookingTimeZone,
      staffName: first.staffName,
      businessAddress: first.businessAddress,
      confirmationExpiresAt: new Date(expiry).toISOString(),
      services: snapshots,
    };
  } catch (error) {
    if (error instanceof ConfirmationError) throw error;
    throw new ConfirmationError("confirmation_temporarily_unavailable");
  }
}
