import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/app/_components/button";
import { cn } from "@/app/_lib/utils";

export function BookingHeader({
  children,
  subtitle,
  onBack,
  disabled,
  referenceDesign = false,
}: {
  referenceDesign?: boolean;
  children: ReactNode;
  subtitle: ReactNode;
  onBack?: () => void;
  disabled: boolean;
}) {
  return (
    <header className="border-b bg-background lg:bg-card">
      <div
        className={cn(
          "flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-14 lg:px-12 lg:py-4",
          referenceDesign &&
            "lg:[&_nav_li>a]:min-h-12.5 lg:[&_nav_li>a]:gap-4 lg:[&_nav_li>span]:min-h-12.5 lg:[&_nav_li>span]:gap-4",
        )}
      >
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
            W
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-base font-semibold">
              Wellness Studio
            </span>
            <p className="text-sm text-muted-foreground">
              <span className="hidden lg:inline">ул. „Шипка“ 18, София</span>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="w-full min-w-0 lg:ml-auto lg:max-w-190">{children}</div>
      </div>
    </header>
  );
}
