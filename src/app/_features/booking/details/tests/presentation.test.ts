import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BookingSummary } from "@/app/_features/booking/details/booking-summary";
import { BookingReview } from "@/app/_features/booking/details/review";
import { formatPersistedPrice } from "@/app/_features/booking/price";

const service = {
  id: "cut",
  name: "Тест услуга",
  category: "Коса",
  durationMinutes: 30,
  cleanupMinutes: 5,
  currency: "GBP",
  priceCents: 2000,
};

test("summary preserves service order, per-currency variable totals and slot-zone override", () => {
  const html = renderToStaticMarkup(
    createElement(BookingSummary, {
      services: [
        service,
        { ...service, id: "variable", name: "Варираща", priceCents: null },
        {
          ...service,
          id: "other",
          name: "Друга",
          priceCents: null,
          currency: "EUR",
        },
      ],
      business: {
        name: "Тест",
        address: "Тест адрес",
        timeZone: "Europe/Sofia",
        currency: "BGN",
        defaultPhoneCountry: "BG",
      },
      staffName: "Тест специалист",
      slot: {
        start: "2026-10-25T00:15:00Z",
        end: "2026-10-25T00:45:00Z",
        date: "2026-10-25",
        timeZone: "Asia/Tokyo",
      },
      onEdit: () => {},
    }),
  );
  assert.ok(html.indexOf("Тест услуга") < html.indexOf("Варираща"));
  assert.ok(html.indexOf("Варираща") < html.indexOf("Друга"));
  assert.ok(html.includes(`от ${formatPersistedPrice(2000, "GBP")}`));
  assert.ok(html.includes(formatPersistedPrice(null, "EUR")));
  assert.match(html, /09:15–09:45/);
  assert.match(html, /Asia\/Tokyo/);
  assert.match(html, /Общо · 1 ч 30 мин/);
});

test("review requires explicit permission and delegates confirm and edit", () => {
  let confirmed = 0;
  let edited = 0;
  const props = {
    contact: {
      name: "Synthetic",
      phone: "synthetic",
      email: "synthetic@example.test",
      note: "",
    },
    canConfirm: false,
    onConfirm: () => confirmed++,
    onEdit: () => edited++,
  };
  const view = BookingReview(props);
  const actions = view.props.children[2].props.children;
  assert.equal(actions[1].props.disabled, true);
  actions[0].props.onClick();
  actions[1].props.onClick();
  assert.equal(edited, 1);
  assert.equal(confirmed, 1);
  const html = renderToStaticMarkup(createElement(BookingReview, props));
  assert.match(html, /Без бележка/);
  assert.match(html, /Все още няма потвърдена резервация/);
});
