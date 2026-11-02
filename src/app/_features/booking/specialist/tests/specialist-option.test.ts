import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RadioGroup } from "@/app/_components/radio-group";
import type { StaffView } from "@/app/_features/booking/api";
import { SpecialistOption } from "@/app/_features/booking/specialist/specialist-option";

const member: StaffView = {
  id: "staff-one",
  name: "Тест Специалист",
  description: "Описание",
  imageUrl: null,
};

test("specialist option renders accessible catalog facts within a prop-driven radio group", () => {
  const html = renderToStaticMarkup(
    createElement(
      RadioGroup,
      { value: member.id, disabled: true },
      createElement(SpecialistOption, { member, selected: true }),
    ),
  );
  assert.match(html, /Тест Специалист/);
  assert.match(html, /Описание/);
  assert.match(html, /ТС/);
  assert.match(html, /aria-labelledby="staff-staff-one-name"/);
  assert.match(html, /aria-describedby="staff-staff-one-description"/);
  assert.match(html, /data-checked/);
  assert.match(html, /disabled/);
});

test("specialist option does not choose the sole member implicitly", () => {
  const option = SpecialistOption({ member, selected: false });
  assert.equal(option.props["data-checked"], undefined);
  assert.equal(option.props.htmlFor, "staff-staff-one");
});
