import type { Metadata } from "next";

import { Confirmation } from "@/app/confirmation/_components/confirmation";

export const metadata: Metadata = {
  title: "Потвърждение на резервация",
  description: "Лично потвърждение на запазен час.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default function ConfirmationPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
      <h1 className="font-heading text-2xl font-semibold">
        Потвърждение на резервация
      </h1>
      <Confirmation />
      <noscript>
        За да видите резервацията, разрешете JavaScript в браузъра.
      </noscript>
    </main>
  );
}
