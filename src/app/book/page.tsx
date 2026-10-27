import { PersistedBooking } from "@/app/book/_components/persisted-booking";

// The persisted, PostgreSQL-backed staff-first entry (#61). Kept on its own
// route so the in-memory prototype at "/" stays honestly separate and is never
// implicitly turned into a real booking.
export default function BookPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#book" className="skip-link">
        Към резервацията
      </a>
      <PersistedBooking />
    </div>
  );
}
