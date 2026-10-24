import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Badge } from "@/app/_components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { Skeleton } from "@/app/_components/skeleton";

test("surface primitives render their composition and forward attributes", () => {
  const html = renderToStaticMarkup(
    createElement(
      Card,
      { size: "sm", id: "summary" },
      createElement(
        CardHeader,
        null,
        createElement(CardTitle, null, "Резервация"),
        createElement(CardDescription, null, "Преглед"),
      ),
      createElement(
        CardContent,
        null,
        createElement(Badge, { variant: "secondary" }, "Демо"),
        createElement(Skeleton, {
          className: "h-4 w-full",
          "aria-hidden": true,
        }),
      ),
      createElement(CardFooter, null, "Общо"),
    ),
  );
  for (const slot of [
    "card",
    "card-header",
    "card-title",
    "card-description",
    "card-content",
    "card-footer",
    "badge",
    "skeleton",
  ]) {
    assert.match(html, new RegExp(`data-slot="${slot}"`));
  }
  assert.match(html, /data-size="sm"/);
  assert.match(html, /id="summary"/);
  assert.match(html, /Демо/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /h-4 w-full/);
});

for (const variant of ["default", "warning", "error", "success"] as const) {
  test(`Alert renders the ${variant} tone with composed content and forwarded props`, () => {
    const html = renderToStaticMarkup(
      createElement(
        Alert,
        { variant, id: "notice", className: "max-w-md" },
        createElement(AlertTitle, null, "Известие"),
        createElement(AlertDescription, null, "Описание"),
      ),
    );
    assert.match(html, new RegExp(`data-variant="${variant}"`));
    assert.match(html, /data-slot="alert"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /id="notice"/);
    assert.match(html, /max-w-md/);
    assert.match(html, /Известие/);
    assert.match(html, /Описание/);
    if (variant !== "default") {
      assert.match(html, new RegExp(`bg-${variant}`));
      assert.match(html, new RegExp(`text-${variant}-foreground`));
      assert.match(html, new RegExp(`border-${variant}-border`));
    }
  });
}
