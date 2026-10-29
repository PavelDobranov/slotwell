import assert from "node:assert/strict";
import test from "node:test";

import type { RetainedBookingIntent } from "@/app/_lib/booking/intent-storage";
import {
  type BookingAgreement,
  BookingApiError,
} from "@/app/_lib/booking/submission-api";
import {
  createSubmissionController as createController,
  type SubmissionControllerDependencies,
} from "@/app/_lib/booking/submission-controller";

// Dispatch through the fake's current implementation so a test can change server outcomes.
function createSubmissionController(deps: SubmissionControllerDependencies) {
  return createController({
    allocate: () => deps.allocate(),
    list: () => deps.list(),
    resolve: (pair) => deps.resolve(pair),
    submit: (pair, input) => deps.submit(pair, input),
    fence: (pair) => deps.fence(pair),
    clear: (pair, fence) => deps.clear(pair, fence),
  });
}

const pair = {
  operationId: "11111111-1111-4111-8111-111111111111",
  credential: "ab".repeat(32),
};
const receipt = {
  appointmentId: "22222222-2222-4222-8222-222222222222",
  confirmationExpiresAt: "2026-11-01T12:00:00.000Z",
  viewToken: "cd".repeat(32),
};
const pending = {
  state: "pending" as const,
  submitBefore: "2026-10-25T12:00:00.000Z",
};
function agreement(): BookingAgreement {
  return {
    staffId: "mimi",
    serviceIds: ["cut"],
    startsAt: "2026-10-25T12:00:00+02:00",
    reviewedServices: [
      {
        id: "cut",
        name: "Коса",
        priceCents: null,
        currency: "EUR",
        durationMinutes: 45,
        cleanupMinutes: 0,
      },
    ],
    contact: {
      name: " Аня ",
      phone: "+12025550100",
      email: "A@example.test",
      note: "  note\n",
      phoneCountry: "US",
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let records: RetainedBookingIntent[] = [];
  const calls: string[] = [];
  const deps: SubmissionControllerDependencies = {
    allocate: async () => {
      calls.push("allocate");
      records.push({ ...pair });
      return { ...pair };
    },
    list: async () => {
      calls.push("list");
      return structuredClone(records);
    },
    resolve: async (_pair: RetainedBookingIntent) => {
      calls.push("resolve");
      return pending;
    },
    submit: async (
      _pair: RetainedBookingIntent,
      _agreement: BookingAgreement,
    ) => {
      calls.push("submit");
      return { ...receipt };
    },
    fence: async (_pair: RetainedBookingIntent) => {
      calls.push("fence");
      return { state: "fenced" as const };
    },
    clear: async (
      owned: RetainedBookingIntent,
      requestFence: (pair: RetainedBookingIntent) => Promise<unknown>,
    ) => {
      calls.push("clear");
      const result = (await requestFence(owned)) as {
        state: "fenced" | "committed";
      };
      if (result.state === "fenced")
        records = records.filter(
          (item) => item.operationId !== owned.operationId,
        );
      return result;
    },
  };
  return {
    deps,
    calls,
    setRecords(value: RetainedBookingIntent[]) {
      records = value;
    },
    records: () => records,
  };
}

test("discovery lists only locators, never selects or networks", async () => {
  const fixture = setup();
  fixture.setRecords([{ ...pair }]);
  const controller = createSubmissionController(fixture.deps);
  await controller.discover();
  assert.deepEqual(fixture.calls, ["list"]);
  assert.deepEqual(controller.getSnapshot().retainedIds, [pair.operationId]);
  assert.equal(controller.getSnapshot().current, null);
  assert.ok(
    !JSON.stringify(controller.getSnapshot()).includes(pair.credential),
  );
});

test("durable allocation completes before checking/registration; overlapping commands refuse", async () => {
  const fixture = setup();
  const allocation = deferred<RetainedBookingIntent>();
  fixture.deps.allocate = () => allocation.promise;
  const controller = createSubmissionController(fixture.deps);
  const starting = controller.startNew();
  const busy = controller.getSnapshot();
  await assert.rejects(controller.startNew(), {
    message: "booking_controller_busy",
  });
  await assert.rejects(controller.discover(), {
    message: "booking_controller_busy",
  });
  assert.equal(
    controller.getSnapshot(),
    busy,
    "busy refusal preserves active state",
  );
  assert.deepEqual(fixture.calls, []);
  fixture.setRecords([{ ...pair }]);
  allocation.resolve({ ...pair });
  await starting;
  assert.deepEqual(fixture.calls, ["list", "resolve"]);
  const current = controller.getSnapshot().current;
  assert.equal(current?.kind, "pending");
  assert.ok(current?.kind === "pending" && current.canSubmit);
});

test("resuming an existing pending intent permits recovery, never a new agreement", async () => {
  const fixture = setup();
  fixture.setRecords([{ ...pair }]);
  const controller = createSubmissionController(fixture.deps);
  await controller.resume(pair.operationId);
  const current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "pending" && !current.canSubmit && !current.canRetry,
  );
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_action_unavailable",
  });
  await assert.rejects(controller.startNew(), {
    message: "booking_controller_action_unavailable",
  });
  assert.equal(fixture.calls.filter((action) => action === "submit").length, 0);
});

test("unknown submission stays locked through pending recovery and later rejection; retry uses owned copies", async () => {
  const fixture = setup();
  const sent: string[] = [];
  fixture.deps.submit = async (owned, input) => {
    assert.ok(
      owned.operationId === pair.operationId &&
        owned.credential === pair.credential,
      "exact retained pair",
    );
    sent.push(JSON.stringify(input));
    input.contact.note = "collaborator mutation";
    throw new BookingApiError(
      sent.length === 1 ? "recovery_unavailable" : "availability_conflict",
      sent.length === 1 ? "unknown" : "rejected",
      sent.length === 1 ? 503 : 409,
    );
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  const input = agreement();
  const original = JSON.stringify(input);
  await controller.submit(input);
  input.contact.name = "caller mutation";
  await controller.recover();
  let current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "pending" && !current.canSubmit && current.canRetry,
  );
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_action_unavailable",
  });
  await controller.retry();
  current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "rejected" && !current.canSubmit && current.canRetry,
  );
  assert.ok(
    sent.length === 2 && sent.every((body) => body === original),
    "same original agreement on retry",
  );
  assert.ok(
    !JSON.stringify(controller.getSnapshot()).includes("caller mutation"),
  );
});

for (const code of [
  "invalid_booking",
  "invalid_contact",
  "review_required",
  "selection_unavailable",
  "availability_conflict",
  "payload_conflict",
  "operation_unavailable",
  "origin_forbidden",
] as const) {
  test(`initial ${code} rejection grants only documented edit permission`, async () => {
    const fixture = setup();
    fixture.deps.submit = async () => {
      throw new BookingApiError(
        code,
        "rejected",
        code.startsWith("invalid_")
          ? 400
          : code === "origin_forbidden"
            ? 403
            : 409,
      );
    };
    const controller = createSubmissionController(fixture.deps);
    await controller.startNew();
    await controller.submit(agreement());
    const current = controller.getSnapshot().current;
    const editable = ![
      "payload_conflict",
      "operation_unavailable",
      "origin_forbidden",
    ].includes(code);
    assert.ok(
      current?.kind === "rejected" &&
        current.canSubmit === editable &&
        current.canRetry,
    );
    await assert.rejects(controller.startNew(), {
      message: "booking_controller_action_unavailable",
    });
    if (editable) await controller.submit(agreement());
    else
      await assert.rejects(controller.submit(agreement()), {
        message: "booking_controller_action_unavailable",
      });
  });
}

test("unknown resolution revokes earlier edit permission until another authenticated resolution", async () => {
  const fixture = setup();
  fixture.deps.submit = async () => {
    throw new BookingApiError("availability_conflict", "rejected", 409);
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  await controller.submit(agreement());
  fixture.deps.resolve = async () => {
    throw new BookingApiError("recovery_unavailable", "unknown", 503);
  };
  await controller.recover();
  const current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "unresolved" && !current.canSubmit,
    "unresolved cannot submit changed agreement",
  );
});

test("committed receipt remains immutable and monotonic across later pending/errors and clear", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  await controller.submit(agreement());
  const current = controller.getSnapshot().current;
  assert.equal(current?.kind, "committed");
  assert.ok(Object.isFrozen(current));
  assert.ok(current?.kind === "committed" && Object.isFrozen(current.receipt));
  await controller.recover();
  fixture.deps.resolve = async () => {
    throw new Error("raw failure");
  };
  await controller.recover();
  await controller.clear();
  const after = controller.getSnapshot().current;
  assert.ok(
    after?.kind === "committed" &&
      after.receipt?.viewToken === receipt.viewToken,
    "original committed receipt preserved",
  );
  assert.equal(
    fixture.calls.filter((action) => action === "fence").length,
    0,
    "known committed is not clearable",
  );
  await assert.rejects(controller.startNew(), {
    message: "booking_controller_action_unavailable",
  });
  await assert.rejects(controller.retry(), {
    message: "booking_controller_action_unavailable",
  });
});

test("clear committed classification retains capacity and requires separate receipt recovery", async () => {
  const fixture = setup();
  fixture.deps.fence = async () => ({ state: "committed" });
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  await controller.clear();
  let current = controller.getSnapshot().current;
  assert.ok(current?.kind === "committed" && current.receipt === null);
  assert.equal(fixture.records().length, 1);
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_action_unavailable",
  });
  fixture.deps.resolve = async () => ({ state: "committed", receipt });
  await controller.recover();
  current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "committed" &&
      current.receipt?.viewToken === receipt.viewToken,
  );
});

test("server fence followed by local deletion failure allows only explicit clear retry", async () => {
  const fixture = setup();
  const clear = fixture.deps.clear;
  fixture.deps.clear = async (owned, requestFence) => {
    await requestFence(owned);
    throw new Error("intent_storage_unavailable");
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  await controller.clear();
  const current = controller.getSnapshot().current;
  assert.ok(
    current?.kind === "fenced" && !current.canSubmit && !current.canRetry,
  );
  assert.equal(fixture.records().length, 1);
  for (const action of [
    () => controller.recover(),
    () => controller.submit(agreement()),
    () => controller.retry(),
    () => controller.startNew(),
  ]) {
    await assert.rejects(action(), {
      message: "booking_controller_action_unavailable",
    });
  }
  fixture.deps.clear = clear;
  await controller.clear();
  assert.equal(controller.getSnapshot().current, null);
  assert.equal(fixture.records().length, 0);
  assert.deepEqual(controller.getSnapshot().retainedIds, []);
  await controller.startNew();
  assert.equal(controller.getSnapshot().current?.kind, "pending");
});

for (const mismatch of [false, true]) {
  test(`another tab ${mismatch ? "changes the credential" : "clears the pair"} before dispatch blocks networking and replacement`, async () => {
    const fixture = setup();
    const controller = createSubmissionController(fixture.deps);
    await controller.startNew();
    fixture.calls.length = 0;
    fixture.setRecords(
      mismatch ? [{ ...pair, credential: "ef".repeat(32) }] : [],
    );
    await controller.submit(agreement());
    await controller.recover();
    assert.deepEqual(fixture.calls, ["list", "list"]);
    assert.equal(controller.getSnapshot().problem, "intent_not_retained");
    assert.ok(
      controller.getSnapshot().current?.operationId === pair.operationId,
    );
    await assert.rejects(controller.startNew(), {
      message: "booking_controller_action_unavailable",
    });
  });
}

test("disposal before a deferred clear callback prevents any new fence request", async () => {
  const fixture = setup();
  const gate = deferred<void>();
  fixture.deps.clear = async (owned, requestFence) => {
    await gate.promise;
    return (await requestFence(owned)) as { state: "fenced" };
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  fixture.calls.length = 0;
  const clearing = controller.clear();
  controller.dispose();
  const disposed = controller.getSnapshot();
  gate.resolve();
  await clearing;
  assert.deepEqual(fixture.calls, [], "no post-disposal fencing");
  assert.equal(controller.getSnapshot(), disposed);
});

test("agreement is copied before deferred storage check, and a second submit cannot dispatch", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  const storage = deferred<RetainedBookingIntent[]>();
  fixture.deps.list = () => storage.promise;
  let sent = "";
  fixture.deps.submit = async (_pair, input) => {
    sent = JSON.stringify(input);
    return receipt;
  };
  const input = agreement();
  const expected = JSON.stringify(input);
  const sending = controller.submit(input);
  input.contact.name = "changed";
  input.reviewedServices[0].cleanupMinutes = 99;
  input.serviceIds = [];
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_busy",
  });
  storage.resolve([{ ...pair }]);
  await sending;
  assert.ok(
    sent === expected,
    "original agreement unchanged through storage await",
  );
});

for (const boundary of ["allocate", "storage", "resolve", "submit"] as const) {
  test(`disposal during ${boundary} ignores late results and never dispatches subsequent work`, async () => {
    const fixture = setup();
    const controller = createSubmissionController(fixture.deps);
    const gate = deferred<void>();
    const entered = deferred<void>();
    if (boundary !== "allocate" && boundary !== "resolve")
      await controller.startNew();
    if (boundary === "allocate")
      fixture.deps.allocate = async () => {
        entered.resolve();
        await gate.promise;
        fixture.setRecords([{ ...pair }]);
        return pair;
      };
    if (boundary === "storage")
      fixture.deps.list = async () => {
        entered.resolve();
        await gate.promise;
        return [{ ...pair }];
      };
    if (boundary === "resolve")
      fixture.deps.resolve = async () => {
        entered.resolve();
        await gate.promise;
        return pending;
      };
    if (boundary === "submit")
      fixture.deps.submit = async () => {
        entered.resolve();
        await gate.promise;
        return receipt;
      };
    let updates = 0;
    controller.subscribe(() => {
      updates++;
    });
    const operation =
      boundary === "allocate" || boundary === "resolve"
        ? controller.startNew()
        : controller.submit(agreement());
    await entered.promise;
    controller.dispose();
    const disposed = controller.getSnapshot();
    const before = updates;
    fixture.calls.length = 0;
    gate.resolve();
    await operation;
    assert.equal(updates, before, "no late notifications");
    assert.equal(
      controller.getSnapshot(),
      disposed,
      "no late state resurrection",
    );
    assert.deepEqual(fixture.calls, [], "no new dependent work");
    assert.equal(fixture.records().length, 1, "disposal is not clearing");
    await assert.rejects(controller.discover(), {
      message: "booking_controller_disposed",
    });
  });
}

for (const afterAllocation of [false, true]) {
  test(`subscriber disposal ${afterAllocation ? "after allocation" : "before allocation"} prevents subsequent side effects`, async () => {
    const fixture = setup();
    const controller = createSubmissionController(fixture.deps);
    controller.subscribe(() => {
      if (!afterAllocation || controller.getSnapshot().current !== null)
        controller.dispose();
    });
    await controller.startNew();
    assert.deepEqual(fixture.calls, afterAllocation ? ["allocate"] : []);
    assert.ok(controller.getSnapshot().disposed);
  });
}

test("observer exceptions, attempted snapshot mutations and reentrant commands cannot change dispatch", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  const refusals: Promise<unknown>[] = [];
  const remove = controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    assert.ok(
      Object.isFrozen(snapshot) && Object.isFrozen(snapshot.retainedIds),
    );
    if (snapshot.activity)
      refusals.push(
        assert.rejects(controller.discover(), {
          message: "booking_controller_busy",
        }),
      );
    throw new Error("private observer error");
  });
  await controller.startNew();
  remove();
  await Promise.all(refusals);
  assert.deepEqual(fixture.calls, ["allocate", "list", "resolve"]);
  const state = controller.getSnapshot();
  assert.throws(() => Object.assign(state, { current: null }));
  assert.throws(() => (state.retainedIds as string[]).push("mutation"));
  assert.ok(state.current && Object.isFrozen(state.current));
  assert.equal(state.problem, null);
});

test("fresh registration resolution can be retried safely without allocating a replacement", async () => {
  const fixture = setup();
  fixture.deps.resolve = async () => {
    throw new BookingApiError("recovery_unavailable", "unknown", 503);
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  assert.equal(controller.getSnapshot().current?.kind, "unresolved");
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_action_unavailable",
  });
  fixture.deps.resolve = async () => pending;
  await controller.recover();
  const current = controller.getSnapshot().current;
  assert.ok(current?.kind === "pending" && current.canSubmit);
  assert.equal(
    fixture.calls.filter((action) => action === "allocate").length,
    1,
  );
});

test("raw failures expose only allowlisted codes and clear errors retain selection", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  fixture.deps.clear = async () => {
    throw new Error("private database details");
  };
  await controller.clear();
  assert.equal(
    controller.getSnapshot().problem,
    "booking_controller_unavailable",
  );
  assert.ok(
    !JSON.stringify(controller.getSnapshot()).includes("private database"),
  );
  assert.equal(fixture.records().length, 1);
  const unresolved = controller.getSnapshot().current;
  assert.ok(
    unresolved?.kind === "unresolved" && !unresolved.canSubmit,
    "failed clear cannot preserve edit permission",
  );
  await assert.rejects(controller.submit(agreement()), {
    message: "booking_controller_action_unavailable",
  });
  await assert.rejects(controller.startNew(), {
    message: "booking_controller_action_unavailable",
  });
});

test("agreement copy failure never leaves changed-submission permission on unresolved state", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  const input = agreement();
  Object.defineProperty(input.contact, "name", {
    get() {
      throw new Error("private getter");
    },
  });
  await controller.submit(input);
  const current = controller.getSnapshot().current;
  assert.ok(current?.kind === "unresolved" && !current.canSubmit);
  assert.equal(fixture.calls.filter((action) => action === "submit").length, 0);
});

test("independent controllers never auto-select another tab's retained pair", async () => {
  const fixture = setup();
  let allocation = 0;
  fixture.deps.allocate = async () => {
    const next = {
      operationId:
        `${++allocation}`.padStart(8, "0") + pair.operationId.slice(8),
      credential: String(allocation).repeat(64),
    };
    fixture.records().push(next);
    return next;
  };
  const first = createSubmissionController(fixture.deps);
  const second = createSubmissionController(fixture.deps);
  await Promise.all([first.startNew(), second.startNew()]);
  const firstId = first.getSnapshot().current?.operationId;
  const secondId = second.getSnapshot().current?.operationId;
  assert.ok(firstId && secondId && firstId !== secondId);
  await first.clear();
  assert.equal(first.getSnapshot().current, null);
  assert.equal(second.getSnapshot().current?.operationId, secondId);
  assert.equal(fixture.records().length, 1);
  await second.submit(agreement());
  assert.equal(second.getSnapshot().current?.kind, "committed");
});

test("submission owns input before synchronous activity observers can mutate it", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  const input = agreement();
  const expected = JSON.stringify(input);
  let sent = "";
  fixture.deps.submit = async (_pair, agreement) => {
    sent = JSON.stringify(agreement);
    return receipt;
  };
  controller.subscribe(() => {
    if (controller.getSnapshot().activity === "submit")
      input.contact.name = "observer mutation";
  });
  await controller.submit(input);
  assert.ok(
    sent === expected,
    "owned agreement predates observer notification",
  );
});

test("final activity-null notification is still protected by single-flight", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  let attempted = false;
  let refused: Promise<void> | undefined;
  controller.subscribe(() => {
    if (controller.getSnapshot().activity === null && !attempted) {
      attempted = true;
      refused = assert.rejects(controller.discover(), {
        message: "booking_controller_busy",
      });
    }
  });
  await controller.startNew();
  assert.ok(attempted && refused);
  await refused;
  assert.deepEqual(fixture.calls, ["allocate", "list", "resolve"]);
});

test("fence response after disposal cannot authorize a new local deletion", async () => {
  const fixture = setup();
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  const gate = deferred<{ state: "fenced" }>();
  const entered = deferred<void>();
  fixture.deps.fence = () => {
    entered.resolve();
    return gate.promise;
  };
  const clearing = controller.clear();
  await entered.promise;
  controller.dispose();
  gate.resolve({ state: "fenced" });
  await clearing;
  assert.equal(
    fixture.records().length,
    1,
    "acknowledgement must not start local deletion after disposal",
  );
});

test("allocation failure is redacted, preserves capacity and never networks", async () => {
  const fixture = setup();
  fixture.deps.allocate = async () => {
    throw new Error("intent_capacity_reached");
  };
  const controller = createSubmissionController(fixture.deps);
  await controller.startNew();
  assert.equal(controller.getSnapshot().problem, "intent_capacity_reached");
  assert.equal(controller.getSnapshot().current, null);
  assert.deepEqual(fixture.calls, []);
});
