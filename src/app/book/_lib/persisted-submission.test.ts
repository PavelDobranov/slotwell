import assert from "node:assert/strict";
import test from "node:test";

import { createIntentAssociation } from "@/app/_features/booking/submission/intent-association";
import type { RetainedBookingIntent } from "@/app/_features/booking/submission/intent-storage";
import { BookingApiError } from "@/app/_lib/booking/submission-api";
import { createPersistedSubmission } from "@/app/book/_lib/persisted-submission";

const pair = {
  operationId: "abcdefab-1111-4111-8111-111111111111",
  credential: "ab".repeat(32),
};
const receipt = {
  appointmentId: "22222222-2222-4222-8222-222222222222",
  viewToken: "cd".repeat(32),
  confirmationExpiresAt: "2030-06-01T12:00:00.000Z",
};
const agreement = {
  staffId: "mimi",
  serviceIds: ["cut"],
  startsAt: "2030-06-01T12:00:00.000Z",
  reviewedServices: [
    {
      id: "cut",
      name: "Cut",
      priceCents: 100,
      currency: "JPY",
      durationMinutes: 30,
      cleanupMinutes: 10,
    },
  ],
  contact: {
    name: "Synthetic",
    phone: "09012345678",
    email: "synthetic@example.test",
    phoneCountry: "JP",
  },
};
function fixture() {
  const values = new Map<string, string>();
  let failWrite = false;
  let failRemove = false;
  let failList = false;
  const association = createIntentAssociation(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrite) throw new Error("private");
      values.set(key, value);
    },
    removeItem: (key) => {
      if (failRemove) throw new Error("private");
      values.delete(key);
    },
  }));
  let records: RetainedBookingIntent[] = [];
  let allocations = 0;
  let resolutions = 0;
  let submissions = 0;
  let unknown = false;
  let committed = false;
  const api = createPersistedSubmission({
    association,
    controller: {
      allocate: async () => {
        allocations++;
        records.push({ ...pair });
        return { ...pair };
      },
      list: async () => {
        if (failList) throw new Error("intent_storage_unavailable");
        return records.map((record) => ({ ...record }));
      },
      resolve: async () => {
        resolutions++;
        assert.equal(
          association.read(),
          pair.operationId,
          "pointer precedes network",
        );
        return committed
          ? { state: "committed", receipt }
          : { state: "pending", submitBefore: "2030-06-01T11:00:00.000Z" };
      },
      submit: async (auth, input) => {
        submissions++;
        assert.deepEqual(auth, pair);
        assert.deepEqual(input, agreement);
        committed = true;
        if (unknown) throw new BookingApiError("unknown_outcome", "unknown", 0);
        return receipt;
      },
      fence: async () =>
        committed ? { state: "committed" } : { state: "fenced" },
      clear: async (_auth, fence) => {
        const result = await fence({ ...pair });
        assert.ok(
          result !== null &&
            typeof result === "object" &&
            "state" in result &&
            (result.state === "fenced" || result.state === "committed"),
        );
        if (result.state === "fenced") records = [];
        return { state: result.state };
      },
    },
  });
  return {
    api,
    association,
    records: () => records,
    counts: () => ({ allocations, resolutions, submissions }),
    failList: (value: boolean) => {
      failList = value;
    },
    failWrite: () => {
      failWrite = true;
    },
    failRemove: () => {
      failRemove = true;
    },
    restoreRemove: () => {
      failRemove = false;
    },
    unknown: () => {
      unknown = true;
    },
    committed: () => {
      committed = true;
    },
    seed: () => {
      records.push({ ...pair });
    },
  };
}

test("initialize discovers only; explicit new intent durably allocates and associates before resolution", async () => {
  const f = fixture();
  await f.api.initialize();
  assert.deepEqual(f.counts(), {
    allocations: 0,
    resolutions: 0,
    submissions: 0,
  });
  await f.api.startNew();
  assert.equal(f.association.read(), pair.operationId);
  assert.equal(f.api.getSnapshot().booking.current?.kind, "pending");
  assert.equal(f.counts().allocations, 1);
});

test("association write failure leaves allocated record discoverable and blocks all networking/replacement", async () => {
  const f = fixture();
  await f.api.initialize();
  f.failWrite();
  await f.api.startNew();
  assert.equal(f.api.getSnapshot().associationProblem, true);
  assert.equal(f.records().length, 1);
  assert.deepEqual(f.counts(), {
    allocations: 1,
    resolutions: 0,
    submissions: 0,
  });
  await assert.rejects(f.api.startNew());
  assert.equal(f.counts().allocations, 1);
});

test("reload/copy resumes recovery-only and never authorizes a changed agreement", async () => {
  const f = fixture();
  f.seed();
  f.association.write(pair.operationId, null);
  await f.api.initialize();
  const current = f.api.getSnapshot().booking.current;
  assert.ok(current?.kind === "pending");
  assert.equal(current.canSubmit, false);
  await assert.rejects(f.api.submit(agreement));
  assert.equal(f.counts().allocations, 0);
});

test("explicit retained selection associates before recovery; missing locator never auto-replaces", async () => {
  const f = fixture();
  f.seed();
  await f.api.initialize();
  await f.api.resume(pair.operationId);
  assert.equal(f.association.read(), pair.operationId);
  assert.equal(f.counts().resolutions, 1);
  const absent = fixture();
  absent.association.write(pair.operationId, null);
  await absent.api.initialize();
  assert.equal(absent.api.getSnapshot().booking.problem, "intent_not_retained");
  assert.equal(absent.counts().allocations, 0);
  await assert.rejects(absent.api.startNew());
});

test("unknown submission remains locked; recover obtains receipt without changing agreement or pair", async () => {
  const f = fixture();
  await f.api.initialize();
  await f.api.startNew();
  f.unknown();
  await f.api.submit(agreement);
  const current = f.api.getSnapshot().booking.current;
  assert.ok(current?.kind === "unresolved");
  assert.equal(current.canSubmit, false);
  await f.api.recover();
  assert.equal(f.api.getSnapshot().booking.current?.kind, "committed");
  assert.equal(f.counts().allocations, 1);
  assert.equal(f.counts().submissions, 1);
});

test("only completed fenced clear removes hint; committed clear retains it", async () => {
  const f = fixture();
  await f.api.initialize();
  await f.api.startNew();
  await f.api.clear();
  assert.equal(f.association.read(), null);
  assert.equal(f.records().length, 0);
  assert.equal(f.api.getSnapshot().booking.current, null);
  const committed = fixture();
  await committed.api.initialize();
  await committed.api.startNew();
  committed.committed();
  await committed.api.clear();
  assert.equal(committed.association.read(), pair.operationId);
  assert.equal(committed.records().length, 1);
  assert.equal(committed.api.getSnapshot().booking.current?.kind, "committed");
});

test("pointer removal failure after completed deletion locks replacement and can be explicitly retried", async () => {
  const f = fixture();
  await f.api.initialize();
  await f.api.startNew();
  f.failRemove();
  await f.api.clear();
  assert.equal(f.api.getSnapshot().associationProblem, true);
  assert.equal(f.association.read(), pair.operationId);
  await assert.rejects(f.api.startNew());
  assert.equal(f.records().length, 0);
  f.restoreRemove();
  await f.api.initialize();
  assert.equal(f.api.getSnapshot().associationProblem, false);
  assert.equal(f.association.read(), null);
  assert.equal(f.counts().allocations, 1);
});

test("failed discovery stays unready and supports explicit storage retry without allocation", async () => {
  const f = fixture();
  f.failList(true);
  await f.api.initialize();
  assert.equal(f.api.getSnapshot().ready, false);
  assert.equal(
    f.api.getSnapshot().booking.problem,
    "intent_storage_unavailable",
  );
  f.failList(false);
  await f.api.initialize();
  assert.equal(f.api.getSnapshot().ready, true);
  assert.equal(f.api.getSnapshot().booking.problem, null);
  assert.equal(f.counts().allocations, 0);
});

test("dispose during durable allocation leaves record discoverable but never associates or networks", async () => {
  let release: (pair: RetainedBookingIntent) => void = () => {};
  const allocated = new Promise<RetainedBookingIntent>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let networks = 0;
  const api = createPersistedSubmission({
    association: {
      read: () => null,
      write: () => {
        writes++;
      },
      remove: () => {},
    },
    controller: {
      allocate: () => allocated,
      list: async () => [],
      resolve: async () => {
        networks++;
        return { state: "pending", submitBefore: "2030-06-01T11:00:00.000Z" };
      },
    },
  });
  await api.initialize();
  const pending = api.startNew();
  api.dispose();
  release({ ...pair });
  await pending;
  assert.equal(writes, 0);
  assert.equal(networks, 0);
});

test("observer reentrancy cannot allocate at final busy publication", async () => {
  const f = fixture();
  let refused = 0;
  let nested: Promise<void> | undefined;
  f.api.subscribe(() => {
    const snapshot = f.api.getSnapshot();
    if (snapshot.ready && !snapshot.busy)
      nested = f.api.startNew().catch(() => {
        refused++;
      });
  });
  await f.api.initialize();
  await nested;
  assert.equal(refused, 1);
  assert.equal(f.counts().allocations, 0);
});

test("malformed or unavailable association stops initialization before any lifecycle call", async () => {
  let calls = 0;
  const api = createPersistedSubmission({
    association: {
      read: () => {
        throw new Error("private");
      },
      write: () => {},
      remove: () => {},
    },
    controller: {
      list: async () => {
        calls++;
        return [];
      },
      allocate: async () => {
        calls++;
        return { ...pair };
      },
    },
  });
  await api.initialize();
  await assert.rejects(api.startNew());
  assert.equal(api.getSnapshot().associationProblem, true);
  assert.equal(calls, 0);
});

test("dispose removes the binding's receipt snapshot and refuses new listeners/actions", async () => {
  const f = fixture();
  await f.api.initialize();
  await f.api.startNew();
  await f.api.submit(agreement);
  assert.equal(f.api.getSnapshot().booking.current?.kind, "committed");
  f.api.dispose();
  assert.equal(f.api.getSnapshot().booking.current === null, true);
  let observed = false;
  f.api.subscribe(() => {
    observed = true;
  });
  await assert.rejects(f.api.initialize());
  assert.equal(observed, false);
});
