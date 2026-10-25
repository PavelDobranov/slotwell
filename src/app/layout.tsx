import type { Metadata } from "next";
import { Geologica, Golos_Text } from "next/font/google";

import "@/app/globals.css";
import { Providers } from "@/app/providers";

// Build-time downloads, self-hosted at runtime. Preload both Bulgarian and
// Latin glyphs; the token board's monospace specimen is not an app font.
const golosText = Golos_Text({
  subsets: ["latin", "cyrillic"],
  variable: "--font-golos-text",
  display: "swap",
});

const geologica = Geologica({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geologica",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Запази час · Ателие Мента",
  description:
    "Демо резервация в измисления салон Ателие Мента. Не се създава реална резервация.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="bg"
      className={`${golosText.variable} ${geologica.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
