import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/app/_components/badge";
import { Button } from "@/app/_components/button";
import { cn } from "@/app/_lib/utils";

export function BookingHeader({
  children,
  onBack,
  disabled,
}: {
  children: ReactNode;
  onBack?: () => void;
  disabled: boolean;
}) {
  return (
    <header className="border-b bg-background lg:bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-14 lg:px-12 lg:py-4">
        <div className="flex min-h-11 shrink-0 items-center gap-2.5">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Назад"
              disabled={disabled}
              onClick={onBack}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          )}
          <span
            aria-hidden="true"
            className={cn(
              "size-9 items-center justify-center rounded-[10px] bg-primary font-heading text-lg font-bold text-primary-foreground",
              onBack ? "hidden lg:flex" : "flex",
            )}
          >
            М
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-base font-semibold">
              Ателие Мента
              <span className="hidden lg:inline"> — демо салон</span>
            </span>
            <p className="text-sm text-muted-foreground">
              ул. „Шипка“ 18, София
            </p>
          </div>
        </div>
        <div className="w-full min-w-0 lg:ml-auto lg:max-w-190">{children}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 lg:px-12">
        <Badge variant="outline">Демо</Badge>
        <p className="text-xs text-muted-foreground">
          Демо версия — не се създава реална резервация.
        </p>
      </div>
    </header>
  );
}
