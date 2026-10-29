import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  type BookingKeys,
  createBookingOperations,
  type IntentFence,
  type IntentResolution,
  type OperationCredential,
  OperationError,
} from "@/server/booking/operations";

type Database = Pick<NodePgDatabase, "transaction">;
type Options = { keys: BookingKeys; clock?: () => number };

/** Register the already-retained pair, then read its authenticated snapshot.
 * Registration may commit even when resolution fails. Neither a pending snapshot
 * nor any failure grants permission to replace or forget the retained pair.
 */
export async function resolveBookingIntent(
  db: Database | undefined,
  authorization: OperationCredential,
  options: Options,
): Promise<IntentResolution> {
  try {
    const pair = {
      operationId: authorization.operationId,
      credential: authorization.credential,
    };
    if (!db) throw new OperationError("recovery_unavailable");
    const operations = createBookingOperations(options.keys);
    await operations.registerIntent(db, pair, options.clock);
    return await operations.resolveIntent(db, pair, options.clock);
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError("recovery_unavailable");
  }
}

/** Explicit clear only: acknowledge a durable fence, or classify committed.
 * Committed does not authorize forgetting. Never register or decrypt to clear.
 */
export async function clearBookingIntent(
  db: Database | undefined,
  authorization: OperationCredential,
  options: Options,
): Promise<IntentFence> {
  try {
    const pair = {
      operationId: authorization.operationId,
      credential: authorization.credential,
    };
    if (!db) throw new OperationError("recovery_unavailable");
    return await createBookingOperations(options.keys).fenceIntent(
      db,
      pair,
      options.clock,
    );
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError("recovery_unavailable");
  }
}
