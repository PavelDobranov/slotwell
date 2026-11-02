import type { SubmissionSnapshot } from "@/app/_features/booking/submission/submission-controller";

/** Translate controller permissions into notice/action visibility, not authority. */
export function recoveryPermissions(
  current: SubmissionSnapshot["current"] | undefined,
  busy: boolean,
) {
  return {
    needsRecovery:
      !busy &&
      Boolean(
        current &&
          (current.kind === "committed" ||
            current.kind === "fenced" ||
            !current.canSubmit),
      ),
    focusNotice:
      !busy &&
      Boolean(
        current &&
          (current.kind === "unresolved" ||
            current.kind === "fenced" ||
            (current.kind === "pending" && !current.canSubmit) ||
            (current.kind === "committed" && !current.receipt)),
      ),
    canRecover: Boolean(current && current.kind !== "fenced"),
    canRetry: Boolean(
      current &&
        current.kind !== "committed" &&
        current.canRetry &&
        !current.canSubmit,
    ),
    canClear: Boolean(current && current.kind !== "committed"),
    canOpenConfirmation: Boolean(
      current?.kind === "committed" && current.receipt,
    ),
  };
}
