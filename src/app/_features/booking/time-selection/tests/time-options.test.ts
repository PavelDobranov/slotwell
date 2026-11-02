import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TimeOptions } from "@/app/_features/booking/time-selection/time-options";

const options = [{ value: "slot-a", label: "09:15–09:52" }];

test("time options render explicit selection and lock without booking context", () => {
  const html = renderToStaticMarkup(
    createElement(TimeOptions, {
      label: "Часове",
      idPrefix: "slot",
      options,
      value: "slot-a",
      disabled: true,
      onSelect: () => {},
    }),
  );
  assert.match(html, /09:15–09:52/);
  assert.match(html, /slot-slot-a/);
  assert.match(html, /data-checked/);
  assert.match(html, /disabled/);
});

test("time options pass only string choices to the owning screen", () => {
  const selected: string[] = [];
  const view = TimeOptions({
    label: "Дати",
    idPrefix: "date",
    options,
    value: null,
    disabled: false,
    onSelect: (value) => selected.push(value),
  });
  view.props.onValueChange(null);
  view.props.onValueChange("slot-a");
  assert.deepEqual(selected, ["slot-a"]);
  assert.equal(view.props.value, null);
});
