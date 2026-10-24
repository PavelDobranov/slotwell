import type { Page } from "@playwright/test";

// Targeted checks for this opaque, solid-background UI, not WCAG certification.
export async function auditRenderedControls(page: Page) {
  return page.locator("main").evaluate((main) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas colour conversion unavailable");
    function rgba(colour: string) {
      if (!context) throw new Error("Canvas colour conversion unavailable");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    }
    function luminance(channels: number[]) {
      return channels.slice(0, 3).reduce((sum, value, index) => {
        const channel = value / 255;
        const linear =
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    }
    // Measure the owner of each text node, not a container whose children
    // can override its colour. Include rendered values of native controls.
    const textElements = Array.from(main.querySelectorAll("*")).filter(
      (element) =>
        Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ),
    );
    const controls = Array.from(
      main.querySelectorAll(
        "input:not([type=hidden]):not([aria-hidden=true]), textarea, select",
      ),
    );
    const contrasts = Array.from(
      new Set([...textElements, ...controls]),
    ).flatMap((element) => {
      if (!element.getClientRects().length || element.matches(":disabled"))
        return [];
      const text =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.value
          : element instanceof HTMLSelectElement
            ? (element.selectedOptions[0]?.textContent ?? "")
            : Array.from(element.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join("");
      if (!text.trim()) return [];
      let ancestor: Element | null = element;
      let background = [255, 255, 255, 255];
      while (ancestor) {
        background = rgba(getComputedStyle(ancestor).backgroundColor);
        if (background[3] === 255) break;
        if (background[3] !== 0)
          throw new Error("Audit needs explicit alpha compositing");
        ancestor = ancestor.parentElement;
      }
      const foreground = rgba(getComputedStyle(element).color);
      if (foreground[3] !== 255)
        throw new Error("Audit needs opaque text colour");
      const a = luminance(foreground);
      const b = luminance(background);
      return [
        {
          text: text.trim().slice(0, 60),
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        },
      ];
    });
    const targets = Array.from(
      main.querySelectorAll<HTMLElement>(
        "button, input:not([type=hidden]):not([aria-hidden=true]), select, textarea, summary",
      ),
    ).flatMap((element) => {
      if (!element.getClientRects().length || element.matches(":disabled"))
        return [];
      const rect = element.getBoundingClientRect();
      const areas = [rect];
      for (const label of main.querySelectorAll("label")) {
        if (label.control === element)
          areas.push(label.getBoundingClientRect());
      }
      return [
        {
          control:
            element.getAttribute("id") ||
            element.textContent?.trim() ||
            element.tagName,
          minimum24: areas.some(
            (area) => area.width >= 24 && area.height >= 24,
          ),
          height: rect.height,
        },
      ];
    });
    return { contrasts, targets };
  });
}
