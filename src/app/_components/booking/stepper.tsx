import { CheckIcon } from "lucide-react";

import { MobileProgress } from "@/app/_components/booking/mobile-progress";
import {
  type BookingPath,
  type BookingState,
  type BookingStep,
  stepOrder,
} from "@/app/_lib/booking/state";
import { validateContact } from "@/app/_lib/booking/validation";
import { cn } from "@/app/_lib/utils";

export const milestoneLabels = [
  "Услуги",
  "Час и специалист",
  "Вашите данни",
  "Преглед",
];

/** Choices have already been revalidated by the booking reducer. This only maps
 * its ordered screens to progress; it never grants forward navigation.
 */
export function bookingProgress(state: BookingState, review: boolean) {
  const order = stepOrder(state.path);
  const unresolved = order.findIndex(
    (step) =>
      (step === "services" && state.serviceIds.length === 0) ||
      (step === "staff" && state.staffId === null) ||
      (step === "time" && state.start === null),
  );
  const screen = Math.min(
    order.indexOf(state.step),
    unresolved < 0 ? 3 : unresolved,
  );
  const current =
    screen === 0
      ? 0
      : screen < 3
        ? 1
        : review && Object.keys(validateContact(state.contact)).length === 0
          ? 3
          : 2;
  const targets: (BookingStep | null)[] = [
    current > 0 ? "services" : null,
    current > 1 ? order[1] : null,
    current > 2 ? "details" : null,
    null,
  ];
  return { current, targets };
}

export const stepLabels: Record<BookingStep, string> = {
  services: "Услуги",
  staff: "Специалист",
  time: "Дата и час",
  details: "Данни и преглед",
};

export function Stepper({
  path,
  step,
  disabled,
  onNavigate,
}: {
  path: BookingPath;
  step: BookingStep;
  disabled: boolean;
  onNavigate: (step: BookingStep) => void;
}) {
  const order = stepOrder(path);
  const current = order.indexOf(step);
  return (
    <nav aria-label="Стъпки на резервацията" className="flex flex-col gap-2">
      <MobileProgress
        current={current + 1}
        total={order.length}
        label={stepLabels[step]}
      />
      <ol className="grid grid-cols-4 gap-1 sm:gap-2">
        {order.map((item, index) => {
          const done = index < current;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-sm",
                  index <= current ? "bg-primary" : "bg-border",
                )}
              />
              <span className="sr-only items-center gap-1.5 sm:not-sr-only sm:flex">
                {done ? (
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="font-mono text-xs text-muted-foreground"
                  >
                    0{index + 1}
                  </span>
                )}
                {stepLabels[item]}
                {done && <span className="sr-only"> (готово)</span>}
              </span>
            </>
          );
          const className = cn(
            "flex flex-col gap-2 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            done && !disabled ? "min-h-11" : "min-h-1 sm:min-h-11",
            index === current && "font-semibold",
            index > current && "text-muted-foreground",
          );
          return (
            <li key={item} aria-current={item === step ? "step" : undefined}>
              {done && !disabled ? (
                <a
                  href="#step-heading"
                  className={className}
                  onClickCapture={(event) => {
                    event.preventDefault();
                    onNavigate(item);
                  }}
                >
                  {content}
                </a>
              ) : (
                <span className={className}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
