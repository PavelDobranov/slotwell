import { BookingWizard } from "@/app/_components/booking/wizard";

const steps = [
  { id: "services", label: "Услуги" },
  { id: "specialist", label: "Специалист" },
  { id: "date-time", label: "Дата и час" },
  { id: "details", label: "Данни и преглед" },
];

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
        <nav aria-label="Стъпки на резервацията">
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {steps.map((step, index) => (
              <li
                key={step.id}
                aria-current={step.id === "services" ? "step" : undefined}
                className="flex items-center gap-3 rounded-md border p-3 text-sm text-muted-foreground aria-[current=step]:border-primary aria-[current=step]:bg-secondary aria-[current=step]:font-semibold aria-[current=step]:text-foreground"
              >
                <span aria-hidden="true" className="font-mono">
                  0{index + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
        </nav>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <BookingWizard />
          <aside
            aria-labelledby="summary-heading"
            className="flex flex-col gap-4 rounded-lg border bg-muted p-6"
          >
            <h2 id="summary-heading" className="text-lg font-semibold">
              Твоят избор
            </h2>
            <p className="text-sm text-muted-foreground">
              Все още няма избрани услуги.
            </p>
            <p className="text-sm text-muted-foreground">
              Тук ще виждаш услугите, продължителността и общата цена.
            </p>
          </aside>
        </div>
      </main>
      <footer className="border-t pt-5 text-sm text-muted-foreground">
        Измислен салон и примерни услуги. Без реално записване и плащане.
      </footer>
    </div>
  );
}
