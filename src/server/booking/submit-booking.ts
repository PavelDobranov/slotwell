import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { BookingInput } from "@/server/booking/book-appointment";
import {
  type BookingKeys,
  type BookingReceipt,
  createBookingOperations,
  type OperationCredential,
  OperationError,
  snapshotBookingInput,
} from "@/server/booking/operations";

export type BookingSubmission = {
  authorization: OperationCredential;
  input: BookingInput;
};

// The booking submission use case: register-plus-submit orchestration and the
// business validation the transport handler used to run inline. Called directly
// (without HTTP) it still enforces the application invariants below. Keys are a
// trusted construction contract; clock defaults to the operations' trusted time.
export async function submitBooking(
  db: Pick<NodePgDatabase, "transaction"> | undefined,
  submission: BookingSubmission,
  options: { keys: BookingKeys; clock?: () => number },
): Promise<BookingReceipt> {
  // Canonical validation bounds primitive values and validates selections/time.
  // Reviewed values express consent only; submit revalidates authoritative
  // catalog values. Reject invalid boundary input before registering an intent.
  const input = snapshotBookingInput(submission.input);
  const authorization = {
    operationId: submission.authorization.operationId,
    credential: submission.authorization.credential,
  };
  // Invalid input remains a validation failure even when setup could not supply a DB.
  if (!db) throw new OperationError("recovery_unavailable");
  const operations = createBookingOperations(options.keys);
  // Retain only owned values across registration's asynchronous boundary.
  // Registration is idempotent, never mints credentials or resets an existing deadline.
  await operations.registerIntent(db, authorization, options.clock);
  return operations.submit(db, authorization, input, options.clock);
}
