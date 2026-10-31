import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Calendar } from "@/app/_components/calendar";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/app/_components/popover";

const start = new Date(2026, 5, 2);
const end = new Date(2026, 7, 1);

function renderCalendar(month: Date) {
  return renderToStaticMarkup(
    createElement(Calendar, {
      mode: "single",
      month,
      today: start,
      selected: start,
      disabled: [{ before: start }, { after: end }, new Date(2026, 5, 4)],
      startMonth: start,
      endMonth: end,
      showOutsideDays: false,
      id: "date-picker",
    }),
  );
}

function dayButton(html: string, day: number) {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const button = buttons.find((button) => button.endsWith(`>${day}</button>`));
  assert.ok(button, `Expected a button for day ${day}`);
  return button;
}

test("Calendar defaults to Bulgarian captions, weekdays and accessible labels", () => {
  const html = renderCalendar(start);
  assert.match(html, /data-slot="calendar"/);
  assert.match(html, /id="date-picker"/);
  assert.match(html, /юни 2026/);
  assert.match(html, /понеделник/);
  assert.match(html, /Към следващия месец/);
  assert.match(html, /Към предишния месец/);
  assert.match(html, /role="grid"/);
  assert.doesNotMatch(html, /Go to the|Monday|Tuesday|June|Today/);
});

test("Calendar respects caller disabled matchers at both horizon boundaries and within the range", () => {
  const june = renderCalendar(start);
  for (const day of [1, 4]) {
    assert.match(dayButton(june, day), /\sdisabled=""/);
  }
  for (const day of [2, 3, 5]) {
    assert.doesNotMatch(dayButton(june, day), /\sdisabled=""/);
  }
  assert.match(june, /line-through/);
  const august = renderCalendar(end);
  assert.doesNotMatch(dayButton(august, 1), /\sdisabled=""/);
  assert.match(dayButton(august, 2), /\sdisabled=""/);
});

test("Calendar keeps caller formatter and accessibility-label overrides", () => {
  const html = renderToStaticMarkup(
    createElement(Calendar, {
      month: start,
      formatters: { formatCaption: () => "Избор на месец" },
      labels: { labelNext: () => "Напред" },
    }),
  );
  assert.match(html, /Избор на месец/);
  assert.match(html, /aria-label="Напред"/);
});

test("Popover exposes a named trigger without rendering closed popup content", () => {
  const html = renderToStaticMarkup(
    createElement(
      Popover,
      null,
      createElement(PopoverTrigger, { id: "calendar-trigger" }, "Календар"),
      createElement(
        PopoverContent,
        null,
        createElement(
          PopoverHeader,
          null,
          createElement(PopoverTitle, null, "Избери дата"),
          createElement(
            PopoverDescription,
            null,
            "Часовете са местни за салона.",
          ),
        ),
      ),
    ),
  );
  assert.match(html, /data-slot="popover-trigger"/);
  assert.match(html, /id="calendar-trigger"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Календар/);
  assert.doesNotMatch(html, /data-slot="popover-content"/);
});
