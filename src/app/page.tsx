import { BookingWizard } from "@/app/_components/booking/wizard";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#booking" className="skip-link">
        Към резервацията
      </a>
      <BookingWizard />
    </div>
  );
}
