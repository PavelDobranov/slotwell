import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { BookingInput } from "@/server/book-appointment";
import {
  type BookingKeys,
  type BookingReceipt,
  canonicalBookingPayload,
  createBookingOperations,
  type OperationCredential,
} from "@/server/booking-operation";

export type BookingSubmission = {
  authorization: OperationCredential;
  input: BookingInput;
};

// The booking submission use case: register-plus-submit orchestration and the
// business validation the transport handler used to run inline. Called directly
// (without HTTP) it still enforces the application invariants below. Keys are a
// trusted construction contract; clock defaults to the operations' trusted time.
export async function submitBooking(
  db: Pick<NodePgDatabase, "transaction">,
  submission: BookingSubmission,
  options: { keys: BookingKeys; clock?: () => number },
): Promise<BookingReceipt> {
  // Canonical validation bounds primitive values and validates selections/time.
  // Reviewed values express consent only; submit revalidates authoritative
  // catalog values. Reject invalid boundary input before registering an intent.
  canonicalBookingPayload(submission.input);
  const operations = createBookingOperations(options.keys);
  // Registration is idempotent, never mints credentials or resets an existing deadline.
  await operations.registerIntent(db, submission.authorization, options.clock);
  return operations.submit(
    db,
    submission.authorization,
    submission.input,
    options.clock,
  );
}
