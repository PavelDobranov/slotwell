import { Info, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import type { BookingState } from "@/app/_features/demo-booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_features/demo-booking/time";

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
      aria-atomic="true"
      variant={invalidated ? "warning" : "info"}
      className="rounded-card px-4 py-3"
    >
      {invalidated ? (
        <TriangleAlert aria-hidden="true" />
      ) : (
        <Info aria-hidden="true" />
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
              {state.path === "time-first"
                ? " След датата и часа потвърди специалиста."
                : " След специалиста потвърди датата и часа."}
            </>
          )}
          {state.start !== null && (
            <>
              {" "}
              {formatBusinessDate(businessDateAt(state.start))} ·{" "}
              {formatBusinessTime(state.start)} остава.
            </>
          )}
          {staffName && <> {staffName} остава избран.</>}
        </output>
      </AlertDescription>
    </Alert>
  );
}
