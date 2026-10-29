// Public interface of the booking capability: submission and confirmation reads, their
// input/output contracts, the application errors, and the key/application
// configuration reader. Transport (origin, cookie policy, content-type/body-size,
// response mapping) lives in the HTTP adapter (src/server/http/booking.routes.ts);
// canonicalization, crypto, and the transaction lifecycle stay private. Lifecycle
// operations beyond submission have no current consumer and are not exposed.
// Internal files import ./submit-booking, ./book-appointment, ./operations, and
// ./configuration directly, not this barrel.

export type { BookingInput } from "@/server/booking/book-appointment";
export { BookingError } from "@/server/booking/book-appointment";
export { readBookingKeys } from "@/server/booking/configuration";
export type {
  ConfirmationCredential,
  ConfirmationView,
} from "@/server/booking/confirmation";
export {
  ConfirmationError,
  readConfirmation,
} from "@/server/booking/confirmation";
export type {
  BookingKeys,
  BookingReceipt,
} from "@/server/booking/operations";
export { OperationError } from "@/server/booking/operations";
export type { BookingSubmission } from "@/server/booking/submit-booking";
export { submitBooking } from "@/server/booking/submit-booking";
