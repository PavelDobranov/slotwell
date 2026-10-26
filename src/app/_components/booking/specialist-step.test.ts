import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SpecialistStep } from "@/app/_components/booking/specialist-step";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";

const salon = createDemoSalon(() => Date.UTC(2026, 5, 1));
function render(
  serviceIds: string[],
  availableStaffIds?: string[],
  staffId: string | null = null,
  start?: number,
) {
  return renderToStaticMarkup(
    createElement(SpecialistStep, {
      salon,
      serviceIds,
      availableStaffIds,
      staffId,
      start,
      onSelect: () => {},
      onNext: () => {},
      onEditServices: () => {},
      onServices: () => {},
      onEditTime: () => {},
    }),
  );
}

test("specialist rows retain unavailable staff with reasons and avatar initials", () => {
  const html = render(["cut_m", "blowdry"]);
  assert.match(html, /Мими Ибрамова/);
  assert.match(html, /Не прави: Мъжко подстригване, Изсушаване и оформяне/);
  assert.match(html, /data-slot="avatar-fallback"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /aria-checked="true"/);
});

test("no specialist warning offers only single-service removals that restore eligibility", () => {
  const html = render(["blowdry", "massage_relax"]);
  assert.match(html, /data-variant="warning"/);
  assert.match(html, /Никой специалист не прави всички избрани услуги заедно/);
  assert.match(html, /Махни „Изсушаване и оформяне“/);
  assert.match(html, /Махни „Релаксиращ масаж“/);
  assert.match(html, /Към услугите/);
  assert.doesNotMatch(
    render(["cut_m", "blowdry", "massage_relax", "massage_deep"]),
    /Махни/,
  );
});

test("specialist cards use the selected surface and keep the trailing radio explicit", () => {
  const html = render(["blowdry"], undefined, "pavel");
  assert.match(html, /rounded-card/);
  assert.match(html, /data-checked:bg-selected/);
  assert.match(html, /data-disabled:bg-muted/);
  const ivan = html.slice(html.indexOf('for="specialist-pavel"'));
  assert.ok(ivan.indexOf('data-slot="avatar"') < ivan.indexOf('role="radio"'));
  assert.match(ivan, /^for="specialist-pavel" data-checked="true"/);
  assert.match(ivan, /aria-checked="true"/);
  assert.doesNotMatch(render(["blowdry"]), /aria-checked="true"/);
  assert.match(
    render(["blowdry"], undefined, "mimi"),
    /for="specialist-mimi" data-checked="true"/,
  );
  assert.doesNotMatch(render(["cut_m"], [], "mimi"), /aria-checked="true"/);
  assert.doesNotMatch(html, /Всеки свободен специалист/);
});

test("reference specialist step shows a compact heading and time-aware descriptions", () => {
  const html = render(["cut_m"], ["pavel"], "pavel", Date.UTC(2026, 5, 1, 12));
  assert.match(html, /<h3[^>]*>Изберете специалист<\/h3>/);
  assert.match(
    html,
    /Показваме кой е свободен за цялото посещение в 15:00–15:30\./,
  );
  assert.match(html, /свободен в 15:00/);
  assert.doesNotMatch(html, /Изборът е задължителен/);
  const disabled = html.slice(
    html.indexOf('for="specialist-mimi"'),
    html.indexOf('for="specialist-emil"'),
  );
  assert.match(disabled, /Не е свободен/);
  assert.doesNotMatch(disabled, /specialist-mimi-services/);
});

test("time-first unavailability is distinct from missing service coverage", () => {
  const html = render(["cut_m"], []);
  assert.match(html, /Не е свободен за цялото посещение в избрания час/);
  assert.match(html, /Към дата и час/);
  assert.doesNotMatch(html, /Никой специалист/);
});
