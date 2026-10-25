import { BookingWizard } from "@/app/_components/booking/wizard";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#booking" className="skip-link">
        Към резервацията
      </a>
      <BookingWizard />
      <footer className="border-t text-sm text-muted-foreground">
        <p className="px-4 py-4 lg:px-12">
          Измислен салон и примерни услуги. Без реално записване и плащане.
          Данните се пазят само докато страницата е отворена.
        </p>
      </footer>
    </div>
  );
}
