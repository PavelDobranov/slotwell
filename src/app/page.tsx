import { BookingHeader } from "@/app/_components/booking/booking-header";
import { BookingWizard } from "@/app/_components/booking/wizard";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#booking" className="skip-link">
        Към резервацията
      </a>
      <BookingHeader />
      <main
        id="booking"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-280 flex-1 flex-col gap-7 rounded-lg px-4 py-5 sm:px-6 sm:pt-8 sm:pb-12"
      >
        <div className="hidden flex-col gap-1 sm:flex">
          <h1 className="text-2xl font-semibold tracking-tight">
            Запази време за себе си
          </h1>
          <p className="text-sm text-muted-foreground">
            Избери услуги, специалист и удобен час. Всички часове са по
            българско време.
          </p>
        </div>
        <h1 className="sr-only sm:hidden">Запази време за себе си</h1>
        <BookingWizard />
      </main>
      <footer className="border-t text-sm text-muted-foreground">
        <p className="mx-auto max-w-280 px-4 py-4 sm:px-6">
          Измислен салон и примерни услуги. Без реално записване и плащане.
          Данните се пазят само докато страницата е отворена.
        </p>
      </footer>
    </div>
  );
}
