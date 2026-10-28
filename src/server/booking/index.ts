// Public interface of the booking capability: the submission use case, its
// input/output contracts, and the application errors. Transport (origin,
// content-type/body-size, response mapping) lives in the HTTP adapter
// (src/server/booking-routes.ts); canonicalization, crypto, and the transaction
// lifecycle stay private. Lifecycle operations beyond submission have no current
// consumer and are not exposed. Internal files import ./submit-booking (and the
// flat implementation modules) directly, not this barrel.

export type { BookingInput } from "@/server/book-appointment";
export { BookingError } from "@/server/book-appointment";
export type { BookingSubmission } from "@/server/booking/submit-booking";
export { submitBooking } from "@/server/booking/submit-booking";
export type {
  BookingKeys,
  BookingReceipt,
} from "@/server/booking-operation";
export { OperationError } from "@/server/booking-operation";
