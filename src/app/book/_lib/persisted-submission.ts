import { createIntentAssociation } from "@/app/_lib/booking/intent-association";
import { allocateBookingIntent } from "@/app/_lib/booking/intent-storage";
import type { BookingAgreement } from "@/app/_lib/booking/submission-api";
import {
  createSubmissionController,
  type SubmissionControllerDependencies,
  type SubmissionSnapshot,
} from "@/app/_lib/booking/submission-controller";

type Snapshot = Readonly<{
  booking: SubmissionSnapshot;
  ready: boolean;
  busy: boolean;
  associationProblem: boolean;
}>;

/** Route binding only. Lifecycle permissions and credentials remain in the controller. */
export function createPersistedSubmission(
  options: {
    association?: ReturnType<typeof createIntentAssociation>;
    controller?: Partial<SubmissionControllerDependencies>;
  } = {},
) {
  const association = options.association ?? createIntentAssociation();
  let alive = true;
  let locked = false;
  let clearedLocator: string | null = null;
  const listeners = new Set<() => void>();
  function associated<T>(action: () => T): T {
    try {
      return action();
    } catch {
      publish({ associationProblem: true });
      throw new Error("intent_association_unavailable");
    }
  }
  const controller = createSubmissionController({
    ...options.controller,
    allocate: async () => {
      associated(() => {
        if (association.read() !== null) throw new Error("associated");
      });
      const pair = await (
        options.controller?.allocate ?? allocateBookingIntent
      )();
      if (!alive) throw new Error("booking_controller_disposed");
      associated(() => association.write(pair.operationId, null));
      return pair;
    },
  });
  let snapshot: Snapshot = Object.freeze({
    booking: controller.getSnapshot(),
    ready: false,
    busy: false,
    associationProblem: false,
  });
  function publish(change: Partial<Snapshot>) {
    if (!alive) return;
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of [...listeners]) {
      if (!alive) break;
      try {
        listener();
      } catch {
        /* Observers cannot authorize side effects. */
      }
    }
  }
  const unsubscribe = controller.subscribe(() =>
    publish({ booking: controller.getSnapshot() }),
  );
  async function run(action: () => Promise<void>, initializing = false) {
    if (
      !alive ||
      locked ||
      (!initializing && (!snapshot.ready || snapshot.associationProblem))
    )
      throw new Error("booking_controller_action_unavailable");
    locked = true;
    try {
      publish({ busy: true });
      if (alive) await action();
    } catch (error) {
      // Controller refusals remain refusals; storage/transport outcomes are already redacted snapshots.
      if (
        !(
          error instanceof Error &&
          error.message === "intent_association_unavailable"
        )
      )
        throw error;
    } finally {
      publish({ busy: false });
      locked = false;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!alive) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: () =>
      run(async () => {
        if (clearedLocator !== null) {
          associated(() => association.remove(clearedLocator as string));
          clearedLocator = null;
        }
        const locator = associated(() => association.read());
        publish({ associationProblem: false });
        if (!alive) return;
        await controller.discover();
        if (!alive) return;
        if (controller.getSnapshot().problem !== null) {
          publish({ ready: false });
          return;
        }
        if (locator !== null && controller.getSnapshot().current === null)
          await controller.resume(locator);
        publish({ ready: true });
      }, true),
    startNew: () =>
      run(async () => {
        if (associated(() => association.read()) !== null)
          throw new Error("booking_controller_action_unavailable");
        if (alive) await controller.startNew();
      }),
    resume: (locator: string) =>
      run(async () => {
        associated(() => {
          const current = association.read();
          if (current !== null && current !== locator)
            throw new Error("associated");
          association.write(locator, current);
        });
        if (alive) await controller.resume(locator);
      }),
    submit: (agreement: BookingAgreement) =>
      run(() => controller.submit(agreement)),
    retry: () => run(() => controller.retry()),
    recover: () => run(() => controller.recover()),
    clear: () =>
      run(async () => {
        const locator = controller.getSnapshot().current?.operationId;
        await controller.clear();
        if (!alive || !locator || controller.getSnapshot().current !== null)
          return;
        clearedLocator = locator;
        associated(() => association.remove(locator));
        clearedLocator = null;
      }),
    dispose() {
      alive = false;
      unsubscribe();
      controller.dispose();
      snapshot = Object.freeze({
        booking: controller.getSnapshot(),
        ready: false,
        busy: false,
        associationProblem: false,
      });
      listeners.clear();
    },
  };
}
