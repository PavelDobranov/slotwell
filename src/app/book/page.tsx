import { PersistedBooking } from "@/app/_features/booking/booking-flow";
import { BookingProvider } from "@/app/_features/booking/context";

// The persisted, PostgreSQL-backed staff-first entry (#61). Kept on its own
// route so the in-memory prototype at "/" stays honestly separate and is never
// implicitly turned into a real booking.
export default function BookPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#book" className="skip-link">
        Към резервацията
      </a>
      <BookingProvider>
        <PersistedBooking />
      </BookingProvider>
    </div>
  );
}
