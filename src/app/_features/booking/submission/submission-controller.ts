import {
  allocateBookingIntent,
  clearRetainedBookingIntent,
  listBookingIntents,
  type RetainedBookingIntent,
} from "@/app/_features/booking/submission/intent-storage";
import {
  type BookingAgreement,
  BookingApiError,
  type BookingIntentFence,
  type BookingIntentResolution,
  type BookingReceipt,
  requestBookingIntentFence,
  resolveRetainedBookingIntent,
  submitBookingIntent,
} from "@/app/_features/booking/submission/submission-api";

export type SubmissionControllerDependencies = {
  allocate: () => Promise<RetainedBookingIntent>;
  list: () => Promise<RetainedBookingIntent[]>;
  resolve: (pair: RetainedBookingIntent) => Promise<BookingIntentResolution>;
  submit: (
    pair: RetainedBookingIntent,
    agreement: BookingAgreement,
  ) => Promise<BookingReceipt>;
  fence: (pair: RetainedBookingIntent) => Promise<BookingIntentFence>;
  clear: typeof clearRetainedBookingIntent;
};
type Activity =
  | "discover"
  | "startNew"
  | "resume"
  | "recover"
  | "submit"
  | "retry"
  | "clear";
type Problem =
  | BookingApiError["code"]
  | "intent_capacity_reached"
  | "intent_storage_unavailable"
  | "intent_clear_unresolved"
  | "intent_not_retained"
  | "booking_recovery_required"
  | "booking_controller_unavailable";
type Current =
  | {
      kind: "pending";
      operationId: string;
      submitBefore: string;
      canSubmit: boolean;
      canRetry: boolean;
    }
  | {
      kind: "unresolved" | "rejected" | "fenced";
      operationId: string;
      code: Problem;
      canSubmit: boolean;
      canRetry: boolean;
    }
  | {
      kind: "committed";
      operationId: string;
      receipt: Readonly<BookingReceipt> | null;
    };
export type SubmissionSnapshot = Readonly<{
  activity: Activity | null;
  retainedIds: readonly string[];
  current: Readonly<Current> | null;
  problem: Problem | null;
  disposed: boolean;
}>;
type Selected = {
  pair: RetainedBookingIntent;
  owned: boolean;
  agreement: BookingAgreement | null;
  uncertain: boolean;
  maySubmit: boolean;
  fenced: boolean;
  committed?: BookingReceipt | null;
};
const editableRejections = new Set([
  "invalid_booking",
  "invalid_contact",
  "review_required",
  "selection_unavailable",
  "availability_conflict",
]);
function problem(error: unknown): Problem {
  if (error instanceof BookingApiError) return error.code;
  if (
    error instanceof Error &&
    [
      "intent_capacity_reached",
      "intent_storage_unavailable",
      "intent_clear_unresolved",
      "intent_not_retained",
    ].includes(error.message)
  )
    return error.message as Problem;
  return "booking_controller_unavailable";
}
function copyAgreement(input: BookingAgreement): BookingAgreement {
  return {
    staffId: input.staffId,
    serviceIds: [...input.serviceIds],
    startsAt: input.startsAt,
    reviewedServices: input.reviewedServices.map(
      ({
        id,
        name,
        priceCents,
        currency,
        durationMinutes,
        cleanupMinutes,
      }) => ({
        id,
        name,
        priceCents,
        currency,
        durationMinutes,
        cleanupMinutes,
      }),
    ),
    contact: {
      name: input.contact.name,
      phone: input.contact.phone,
      email: input.contact.email,
      ...(input.contact.note === undefined ? {} : { note: input.contact.note }),
      ...(input.contact.phoneCountry === undefined
        ? {}
        : { phoneCountry: input.contact.phoneCountry }),
    },
  };
}

/** One tab's selected intent. No persistence except through the reviewed storage API. */
export function createSubmissionController(
  overrides: Partial<SubmissionControllerDependencies> = {},
) {
  const deps: SubmissionControllerDependencies = {
    allocate: allocateBookingIntent,
    list: listBookingIntents,
    resolve: resolveRetainedBookingIntent,
    submit: submitBookingIntent,
    fence: requestBookingIntentFence,
    clear: clearRetainedBookingIntent,
    ...overrides,
  };
  let selected: Selected | null = null;
  let busy = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  let snapshot: SubmissionSnapshot = Object.freeze({
    activity: null,
    retainedIds: Object.freeze([]),
    current: null,
    problem: null,
    disposed: false,
  });
  function publish(change: Partial<SubmissionSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of [...listeners]) {
      if (disposed) break;
      try {
        listener();
      } catch {
        /* Observers cannot change transaction/dispatch outcomes. */
      }
    }
  }
  function show(
    kind: "pending" | "unresolved" | "rejected" = "unresolved",
    code: Problem = "booking_recovery_required",
    submitBefore = "",
  ) {
    if (!selected || disposed) return;
    const { pair, committed, fenced, maySubmit, agreement } = selected;
    let current: Current;
    if (committed !== undefined) {
      current = {
        kind: "committed",
        operationId: pair.operationId,
        receipt: committed === null ? null : Object.freeze({ ...committed }),
      };
    } else if (fenced) {
      current = {
        kind: "fenced",
        operationId: pair.operationId,
        code,
        canSubmit: false,
        canRetry: false,
      };
    } else {
      const flags = {
        operationId: pair.operationId,
        canSubmit: maySubmit,
        canRetry: agreement !== null,
      };
      current =
        kind === "pending"
          ? { kind, ...flags, submitBefore }
          : { kind, ...flags, code };
    }
    publish({ current: Object.freeze(current) });
  }
  async function run(
    activity: Activity,
    task: () => Promise<void>,
    allowed = true,
    prepare?: () => void,
  ) {
    if (disposed) throw new Error("booking_controller_disposed");
    if (busy) throw new Error("booking_controller_busy");
    if (!allowed) throw new Error("booking_controller_action_unavailable");
    busy = true;
    try {
      prepare?.();
      if (disposed) return;
      publish({ activity, problem: null });
      if (!disposed) await task();
    } catch (error) {
      if (!disposed) {
        const rejected =
          error instanceof BookingApiError && error.outcome === "rejected";
        // Only send() can grant editing after an authoritative submission rejection.
        if (
          selected &&
          !(rejected && (activity === "submit" || activity === "retry"))
        )
          selected.maySubmit = false;
        const code = problem(error);
        publish({ problem: code });
        show(rejected ? "rejected" : "unresolved", code);
      }
    } finally {
      if (!disposed) publish({ activity: null });
      busy = false;
    }
  }
  function retain(pair: RetainedBookingIntent, owned: boolean): Selected {
    const retained: Selected = {
      pair: { operationId: pair.operationId, credential: pair.credential },
      owned,
      agreement: null,
      uncertain: false,
      maySubmit: false,
      fenced: false,
    };
    selected = retained;
    show();
    return retained;
  }
  async function checkRetained(owned: Selected) {
    if (disposed) return false;
    const records = await deps.list();
    if (disposed) return false;
    const present = records.some(
      (pair) =>
        pair.operationId === owned.pair.operationId &&
        pair.credential === owned.pair.credential,
    );
    if (!present) {
      owned.maySubmit = false;
      throw new Error("intent_not_retained");
    }
    publish({
      retainedIds: Object.freeze(records.map(({ operationId }) => operationId)),
    });
    return !disposed;
  }
  async function recover(owned: Selected) {
    owned.maySubmit = false;
    if (!(await checkRetained(owned)) || disposed) return;
    const result = await deps.resolve({ ...owned.pair });
    if (disposed) return;
    if (result.state === "committed") {
      owned.committed = { ...result.receipt };
      owned.maySubmit = false;
      show();
    } else {
      if (owned.agreement === null && owned.owned && !owned.uncertain)
        owned.maySubmit = true;
      show("pending", "booking_recovery_required", result.submitBefore);
    }
  }
  async function send(owned: Selected) {
    if (!(await checkRetained(owned)) || disposed) return;
    owned.maySubmit = false;
    try {
      const result = await deps.submit(
        { ...owned.pair },
        copyAgreement(owned.agreement as BookingAgreement),
      );
      if (disposed) return;
      owned.committed = { ...result };
      show();
    } catch (error) {
      const rejected =
        error instanceof BookingApiError && error.outcome === "rejected";
      if (!rejected) owned.uncertain = true;
      owned.maySubmit =
        rejected && editableRejections.has(error.code) && !owned.uncertain;
      throw error;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    discover: () =>
      run("discover", async () => {
        const records = await deps.list();
        if (!disposed)
          publish({
            retainedIds: Object.freeze(
              records.map(({ operationId }) => operationId),
            ),
          });
      }),
    startNew: () =>
      run(
        "startNew",
        async () => {
          const pair = await deps.allocate();
          if (disposed) return;
          const owned = retain(pair, true);
          if (!disposed) await recover(owned);
        },
        selected === null,
      ),
    resume: (operationId: string) =>
      run(
        "resume",
        async () => {
          const records = await deps.list();
          if (disposed) return;
          const pair = records.find((item) => item.operationId === operationId);
          if (!pair) throw new Error("intent_not_retained");
          const owned = retain(pair, false);
          if (!disposed) await recover(owned);
        },
        selected === null,
      ),
    recover: () =>
      run(
        "recover",
        async () => {
          if (selected) await recover(selected);
        },
        selected !== null && !selected.fenced,
      ),
    submit: (agreement: BookingAgreement) =>
      run(
        "submit",
        async () => {
          if (selected) await send(selected);
        },
        Boolean(
          selected?.owned &&
            selected.maySubmit &&
            !selected.fenced &&
            selected.committed === undefined,
        ),
        () => {
          if (!selected) return;
          selected.maySubmit = false;
          selected.agreement = copyAgreement(agreement);
        },
      ),
    retry: () =>
      run(
        "retry",
        async () => {
          if (selected) await send(selected);
        },
        selected !== null &&
          selected.agreement !== null &&
          !selected.fenced &&
          selected.committed === undefined,
      ),
    clear: () =>
      run(
        "clear",
        async () => {
          if (!selected) return;
          const owned = selected;
          if (owned.committed !== undefined) {
            show();
            return;
          }
          const result = await deps.clear({ ...owned.pair }, async (pair) => {
            if (disposed) throw new Error("booking_controller_disposed");
            const acknowledgement = await deps.fence({ ...pair });
            if (acknowledgement.state === "fenced") owned.fenced = true;
            if (disposed) throw new Error("booking_controller_disposed");
            return acknowledgement;
          });
          if (disposed) return;
          if (result.state === "fenced") {
            owned.agreement = null;
            selected = null;
            publish({
              current: null,
              retainedIds: Object.freeze(
                snapshot.retainedIds.filter(
                  (id) => id !== owned.pair.operationId,
                ),
              ),
            });
          } else {
            owned.committed = null;
            owned.maySubmit = false;
            show();
          }
        },
        selected !== null,
      ),
    dispose() {
      disposed = true;
      selected = null;
      listeners.clear();
      snapshot = Object.freeze({
        activity: null,
        retainedIds: Object.freeze([]),
        current: null,
        problem: null,
        disposed: true,
      });
    },
  };
}
