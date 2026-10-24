import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SpecialistStep } from "@/app/_components/booking/specialist-step";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";

const salon = createDemoSalon(() => Date.UTC(2026, 5, 1));
function render(serviceIds: string[], availableStaffIds?: string[]) {
  return renderToStaticMarkup(
    createElement(SpecialistStep, {
      salon,
      serviceIds,
      availableStaffIds,
      staffId: null,
      onSelect: () => {},
      onNext: () => {},
      onEditServices: () => {},
      onServices: () => {},
      onEditTime: () => {},
    }),
  );
}

test("specialist rows retain unavailable staff with reasons and avatar initials", () => {
  const html = render(["haircut", "beard"]);
  assert.match(html, /Мила/);
  assert.match(html, /Не прави: Оформяне на брада/);
  assert.match(html, /data-slot="avatar-fallback"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /aria-checked="true"/);
});

test("no specialist warning offers only single-service removals that restore eligibility", () => {
  const html = render(["beard", "wash"]);
  assert.match(html, /data-variant="warning"/);
  assert.match(html, /Никой специалист не прави всички избрани услуги заедно/);
  assert.match(html, /Махни „Оформяне на брада“/);
  assert.match(html, /Махни „Измиване и оформяне“/);
  assert.match(html, /Към услугите/);
  assert.doesNotMatch(render(["haircut", "beard", "wash", "color"]), /Махни/);
});

test("time-first unavailability is distinct from missing service coverage", () => {
  const html = render(["haircut"], []);
  assert.match(html, /Не е свободен за цялото посещение в избрания час/);
  assert.match(html, /Към дата и час/);
  assert.doesNotMatch(html, /Никой специалист/);
});
