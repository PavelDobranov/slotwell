import { BookingWizard } from "@/app/_components/booking/wizard";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-6 sm:px-8 sm:py-10">
      <a href="#booking" className="skip-link">
        Към резервацията
      </a>
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold tracking-tight">
            Студио Искра — демо салон
          </p>
          <p className="text-sm text-muted-foreground">
            София · Подстригване и грижа за косата
          </p>
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Демо версия — не се създава реална резервация.
        </p>
      </header>
      <main
        id="booking"
        tabIndex={-1}
        className="flex flex-col gap-8 rounded-lg"
      >
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Онлайн резервация
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Запази време за себе си
          </h1>
          <p className="text-muted-foreground">
            Първо услугите, после специалистът и удобното време.
          </p>
        </div>
        <BookingWizard />
      </main>
      <footer className="border-t pt-5 text-sm text-muted-foreground">
        Измислен салон и примерни услуги. Без реално записване и плащане.
      </footer>
    </div>
  );
}
