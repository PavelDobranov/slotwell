import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ServiceView } from "@/app/_features/booking/api";
import { ServiceOption } from "@/app/_features/booking/services/service-option";

const service: ServiceView = {
  id: "cut",
  name: "Тест услуга",
  category: "Коса",
  priceCents: 2500,
  currency: "GBP",
  durationMinutes: 37,
  cleanupMinutes: 0,
};

test("service option renders catalog facts and explicit selection without booking context", () => {
  const html = renderToStaticMarkup(
    createElement(ServiceOption, {
      service,
      selected: true,
      disabled: true,
      onToggle: () => {},
    }),
  );
  assert.match(html, /Тест услуга/);
  assert.match(html, /37 мин/);
  assert.match(html, /GBP/);
  assert.match(html, /service-cut/);
  assert.match(html, /data-checked/);
  assert.match(html, /disabled/);
});

test("unselected service option does not invent selection and delegates toggling", () => {
  let toggles = 0;
  const option = ServiceOption({
    service,
    selected: false,
    disabled: false,
    onToggle: () => {
      toggles++;
    },
  });
  assert.equal(option.props["data-checked"], undefined);
  const checkbox = option.props.children[0];
  assert.equal(checkbox.props.checked, false);
  checkbox.props.onCheckedChange();
  assert.equal(toggles, 1);
});
