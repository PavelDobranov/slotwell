import { DemoBookingProvider } from "@/app/_features/demo-booking/context";
import { BookingWizard } from "@/app/_features/demo-booking/wizard";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#booking" className="skip-link">
        Към резервацията
      </a>
      <DemoBookingProvider>
        <BookingWizard />
      </DemoBookingProvider>
    </div>
  );
}
