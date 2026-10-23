"use client";

import { useEffect, useState } from "react";

import { businessDateAt, formatBusinessDate } from "@/app/_lib/booking/time";

export function BookingWizard() {
  const [referenceTime, setReferenceTime] = useState<number | null>(null);

  useEffect(() => {
    setReferenceTime(Date.now());
  }, []);

  const today = referenceTime === null ? null : businessDateAt(referenceTime);

  return (
    <section
      aria-labelledby="services-heading"
      className="flex min-w-0 flex-col gap-4 py-2"
    >
      <p className="text-sm font-medium text-muted-foreground">Стъпка 1 от 4</p>
      <h2 id="services-heading" className="text-2xl font-semibold">
        Услуги
      </h2>
      <p className="text-muted-foreground">
        Тук ще можеш да избереш една или повече услуги за посещението си.
        Изборът на услуги ще бъде добавен в следващата стъпка на прототипа.
      </p>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {today === null ? (
          "Подготвяме датата на салона…"
        ) : (
          <>
            Днес: <time dateTime={today}>{formatBusinessDate(today)}</time>
          </>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        Всички часове са местни за салона в София.
      </p>
      <noscript>
        За избор на услуги е необходимо да включиш JavaScript.
      </noscript>
    </section>
  );
}
