import type { ServiceView } from "@/app/_features/booking/api";
import type { PersistedState } from "@/app/_features/booking/context";
import type { createPersistedSubmission } from "@/app/_features/booking/submission/persisted-submission";

/** UI gates only. The binding/controller still authorize every command. */
export function draftPermissions({
  state,
  selectedServices,
  submission,
  catalogFetching,
  catalogError,
}: {
  state: PersistedState;
  selectedServices: readonly ServiceView[];
  submission: ReturnType<
    ReturnType<typeof createPersistedSubmission>["getSnapshot"]
  > | null;
  catalogFetching: boolean;
  catalogError: boolean;
}) {
  const current = submission?.booking.current;
  const busy = !submission?.ready || submission.busy;
  const noSelectionProblem =
    !current &&
    Boolean(
      submission?.booking.problem || submission?.booking.retainedIds.length,
    );
  const draftLocked =
    busy ||
    Boolean(
      submission?.associationProblem ||
        noSelectionProblem ||
        (current &&
          (current.kind === "committed" ||
            current.kind === "fenced" ||
            !current.canSubmit)),
    );
  const consent = selectedServices.map(
    ({ id, name, priceCents, currency, durationMinutes, cleanupMinutes }) => ({
      id,
      name,
      priceCents,
      currency,
      durationMinutes,
      cleanupMinutes,
    }),
  );
  const reviewMatches =
    state.reviewedServices !== null &&
    JSON.stringify(state.reviewedServices) === JSON.stringify(consent) &&
    selectedServices.length === state.serviceIds.length;
  const timingCurrent =
    state.catalogTimingKey ===
      JSON.stringify(
        consent.map(({ id, durationMinutes, cleanupMinutes }) => [
          id,
          durationMinutes,
          cleanupMinutes,
        ]),
      ) && state.slotTimingKey === state.catalogTimingKey;
  return {
    busy,
    draftLocked,
    reviewMatches,
    timingCurrent,
    canConfirm:
      !draftLocked &&
      reviewMatches &&
      timingCurrent &&
      !catalogFetching &&
      !catalogError,
  };
}
