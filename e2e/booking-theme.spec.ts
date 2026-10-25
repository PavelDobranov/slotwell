import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`${width}px Clear Day fonts are rendered and served locally`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 880 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    const external: string[] = [];
    const fonts: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:3100") external.push(url.href);
      if (request.resourceType() === "font") fonts.push(url.pathname);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(message.text());
    });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("#step-heading")).toHaveCSS(
      "font-family",
      /Geologica/,
    );
    await expect(page.locator("header p").first()).toHaveCSS(
      "font-family",
      /Golos Text/,
    );

    // Computed families alone can hide fallback glyphs. Inspect actual Cyrillic
    // rendering through Chromium's CSS domain as well.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    for (const [selector, family] of [
      ["#step-heading", "Geologica"],
      ["header p", "Golos Text"],
    ]) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      const rendered = await cdp.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      expect(rendered.fonts.length).toBeGreaterThan(0);
      for (const font of rendered.fonts) {
        expect(font.isCustomFont).toBe(true);
        // Variable fonts can expose an internal style suffix (e.g. Thin Roman).
        expect(font.familyName).toMatch(new RegExp(`^${family}(?: |$)`));
        expect(font.glyphCount).toBeGreaterThan(0);
      }
    }
    await cdp.detach();
    expect(fonts.length).toBeGreaterThanOrEqual(4); // Latin + Cyrillic, two families.
    expect(fonts.every((path) => path.startsWith("/_next/static/"))).toBe(true);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(246, 247, 244)",
    );
    await expect(page.locator("body")).toHaveCSS("color", "rgb(19, 26, 23)");
    await expect(page.locator('[data-slot="card"]').first()).toHaveCSS(
      "border-radius",
      "14px",
    );
    await expect(
      page.getByRole("button", { name: "Продължи", exact: true }),
    ).toHaveCSS("border-radius", "12px");
    const checkbox = page.getByRole("checkbox", { name: /Подстригване/ });
    await checkbox.focus();
    await expect(checkbox).toHaveCSS("outline-color", "rgb(47, 125, 105)");
    await expect(checkbox).toHaveCSS("outline-width", "2px");
    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const value = (name: string) =>
        style.getPropertyValue(`--${name}`).trim();
      const luminance = (hex: string) => {
        // The production CSS minifier shortens #ffffff to #fff.
        const full = hex.length === 4 ? hex.replace(/[^#]/g, "$&$&") : hex;
        if (!/^#[0-9a-f]{6}$/i.test(full))
          throw new Error(`Expected opaque hex token: ${hex}`);
        const rgb = full.slice(1).match(/.{2}/g);
        if (!rgb) throw new Error(`Missing RGB channels: ${hex}`);
        return rgb.reduce((sum, channel, index) => {
          const srgb = Number.parseInt(channel, 16) / 255;
          const linear =
            srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          return sum + linear * [0.2126, 0.7152, 0.0722][index];
        }, 0);
      };
      return (
        [
          ["input", "card", 3],
          ["input", "background", 3],
          ["ring", "card", 3],
          ["ring", "background", 3],
          ["ring", "selected", 3],
          ["primary-foreground", "primary", 4.5],
          ["muted-foreground", "background", 4.5],
          ["accent-foreground", "accent", 4.5],
          ["warning-foreground", "warning", 4.5],
          ["error-foreground", "error", 4.5],
          ["success-foreground", "success", 4.5],
        ] as const
      ).map(([foreground, background, minimum]) => {
        const a = luminance(value(foreground));
        const b = luminance(value(background));
        return {
          foreground,
          background,
          minimum,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    expect(contrasts.filter(({ ratio, minimum }) => ratio < minimum)).toEqual(
      [],
    );
    await page.screenshot({
      path: `coverage/playwright/theme-30-${width}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(checkbox).toHaveCSS("transition-duration", "0s");
    if (width === 390) {
      await page.getByRole("button", { name: "Виж избора" }).click();
      await expect(page.getByRole("dialog")).toHaveCSS(
        "animation-name",
        "none",
      );
      await expect(page.getByRole("dialog")).toContainText("Твоят избор");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
}
