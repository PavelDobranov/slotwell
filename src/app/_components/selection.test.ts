import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Checkbox } from "@/app/_components/checkbox";
import { RadioGroup, RadioGroupItem } from "@/app/_components/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/app/_components/toggle-group";

test("Checkbox forwards selected, disabled and accessible attributes", () => {
  const html = renderToStaticMarkup(
    createElement(Checkbox, {
      defaultChecked: true,
      disabled: true,
      id: "service",
      "aria-label": "Подстригване",
    }),
  );
  assert.match(html, /data-slot="checkbox"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /data-disabled/);
  assert.match(html, /id="service"/);
  assert.match(html, /aria-label="Подстригване"/);
});

test("RadioGroup composes named choices with selected and disabled states", () => {
  const html = renderToStaticMarkup(
    createElement(
      RadioGroup,
      { defaultValue: "first", "aria-label": "Специалист" },
      createElement(RadioGroupItem, { value: "first", "aria-label": "Алекс" }),
      createElement(RadioGroupItem, {
        value: "second",
        "aria-label": "Мила",
        disabled: true,
      }),
    ),
  );
  assert.match(html, /data-slot="radio-group"/);
  assert.match(html, /data-slot="radio-group-item"/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /data-disabled/);
});

test("ToggleGroup renders the booking route segmented control", () => {
  const html = renderToStaticMarkup(
    createElement(
      ToggleGroup,
      {
        variant: "segmented",
        defaultValue: ["specialist-first"],
        "aria-label": "Ред на избор",
      },
      createElement(
        ToggleGroupItem,
        { value: "specialist-first" },
        "Първо специалист",
      ),
      createElement(
        ToggleGroupItem,
        { value: "time-first", disabled: true },
        "Първо дата и час",
      ),
    ),
  );
  assert.match(html, /data-slot="toggle-group"/);
  assert.match(html, /data-variant="segmented"/);
  assert.match(html, /data-spacing="1"/);
  assert.match(html, /bg-muted p-1/);
  assert.match(html, /aria-pressed:bg-background/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /data-disabled/);
  assert.match(html, /Първо специалист/);
  assert.match(html, /Първо дата и час/);
});

for (const variant of ["default", "outline"] as const) {
  test(`ToggleGroup preserves the registry ${variant} variant without segmented styling`, () => {
    const html = renderToStaticMarkup(
      createElement(
        ToggleGroup,
        { variant, "aria-label": "Избор" },
        createElement(ToggleGroupItem, { value: "first" }, "Първи"),
      ),
    );
    assert.match(html, /data-spacing="2"/);
    assert.doesNotMatch(html, /bg-muted p-1/);
  });
}
