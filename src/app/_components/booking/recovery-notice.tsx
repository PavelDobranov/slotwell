import { CircleCheck, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import type { BookingState } from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";

export function RecoveryNotice({
  state,
  pathSwitched,
  staffName,
}: {
  state: BookingState;
  pathSwitched: boolean;
  staffName?: string;
}) {
  if (!state.notice && !pathSwitched) return <output className="hidden" />;
  const invalidated = Boolean(state.notice);
  return (
    <Alert
      role={invalidated ? "alert" : "status"}
      variant={invalidated ? "warning" : "default"}
      className="px-4 py-3"
    >
      {invalidated ? (
        <TriangleAlert aria-hidden="true" />
      ) : (
        <CircleCheck aria-hidden="true" />
      )}
      <AlertTitle>
        {invalidated ? "Изборът е променен" : "Запазихме избора ти"}
      </AlertTitle>
      <AlertDescription>
        <output role="presentation">
          {invalidated ? (
            <>{state.notice} Данните ти за контакт са запазени.</>
          ) : (
            <>
              Валидният избор е запазен.
              {state.start !== null && (
                <>
                  {" "}
                  {formatBusinessDate(businessDateAt(state.start))} ·{" "}
                  {formatBusinessTime(state.start)} остава.
                </>
              )}
              {staffName && <> {staffName} остава избран.</>}
              {state.path === "time-first"
                ? " След датата и часа потвърди специалиста."
                : " След специалиста потвърди датата и часа."}
            </>
          )}
        </output>
      </AlertDescription>
    </Alert>
  );
}
