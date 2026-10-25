import {
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
  state,
  review,
  disabled,
  onNavigate,
}: {
  state: BookingState;
  review: boolean;
  disabled: boolean;
  onNavigate: (step: BookingStep) => void;
}) {
  const { current, targets } = bookingProgress(state, review);
  return (
    <nav aria-label="Стъпки на резервацията">
      <p className="sr-only">
        Стъпка {current + 1} от {milestoneLabels.length}
      </p>
      <ol className="grid grid-cols-4 gap-1.5 lg:gap-3">
        {milestoneLabels.map((label, index) => {
          const target = targets[index];
          const done = target !== null;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 w-full rounded-[2px]",
                  index <= current ? "bg-primary" : "bg-border",
                )}
              />
              <span className="sr-only lg:not-sr-only lg:flex">
                {index + 1}. {label}
                {done && <span className="sr-only"> (готово)</span>}
              </span>
            </>
          );
          const className = cn(
            "flex min-h-11 flex-col justify-center gap-1.5 rounded-sm lg:justify-start text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            index === current && "font-semibold",
            index > current && "text-muted-foreground",
          );
          return (
            <li
              key={label}
              aria-current={index === current ? "step" : undefined}
            >
              {done && !disabled ? (
                <a
                  href="#step-heading"
                  className={className}
                  onClickCapture={(event) => {
                    event.preventDefault();
                    if (target !== null) onNavigate(target);
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
