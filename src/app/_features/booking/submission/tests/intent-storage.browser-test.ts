import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import ts from "typescript";

// Isolated, synthetic credentials only. No traces/screenshots or credential output.
let browser: Browser;
let source: string;
let pageErrorCount = 0;
beforeEach(() => {
  pageErrorCount = 0;
});
afterEach(() => {
  assert.equal(pageErrorCount, 0, "no uncaught browser exceptions");
});
before(async () => {
  source = ts.transpileModule(
    readFileSync(
      "src/app/_features/booking/submission/intent-storage.ts",
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

async function newPage(context: BrowserContext) {
  const page = await context.newPage();
  page.on("pageerror", () => {
    pageErrorCount++;
  });
  // tsx/esbuild adds this name-preservation helper inside serialized evaluate callbacks.
  await page.addInitScript("globalThis.__name = (fn) => fn;");
  await page.route("http://localhost/**", (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith("module.js")
        ? "text/javascript"
        : "text/html",
      body: route.request().url().endsWith("module.js")
        ? source
        : "<!doctype html><title>Intent storage test</title>",
    }),
  );
  await page.goto("http://localhost/");
  return page;
}

test("concurrent first-open tabs retain exactly 16 independent pairs without eviction", async () => {
  const context = await browser.newContext();
  try {
    const pages = await Promise.all(
      Array.from({ length: 4 }, () => newPage(context)),
    );
    const counts = await Promise.all(
      pages.map((page) =>
        page.evaluate(async () => {
          const storage = await import(String("/module.js"));
          const results = await Promise.all(
            Array.from({ length: 6 }, async () => {
              try {
                await storage.allocateBookingIntent();
                return "ok";
              } catch (error) {
                return (error as Error).message;
              }
            }),
          );
          return {
            ok: results.filter((r) => r === "ok").length,
            full: results.filter((r) => r === "intent_capacity_reached").length,
          };
        }),
      ),
    );
    assert.equal(
      counts.reduce((n, r) => n + r.ok, 0),
      16,
    );
    assert.equal(
      counts.reduce((n, r) => n + r.full, 0),
      8,
    );
    assert.equal(
      await pages[0].evaluate(async () => {
        const storage = await import(String("/module.js"));
        const records = await storage.listBookingIntents();
        return (
          records.length === 16 &&
          new Set(records.map((r: { credential: string }) => r.credential))
            .size === 16 &&
          records.every(
            (r: { operationId: string; credential: string }) =>
              Object.keys(r).sort().join(",") === "credential,operationId" &&
              /^[0-9a-f-]{36}$/.test(r.operationId) &&
              /^[0-9a-f]{64}$/.test(r.credential),
          )
        );
      }),
      true,
    );
    await Promise.all(pages.map((p) => p.close()));
    const resumed = await newPage(context);
    assert.equal(
      await resumed.evaluate(
        async () =>
          (await (await import(String("/module.js"))).listBookingIntents())
            .length,
      ),
      16,
    );
    await resumed.reload();
    assert.equal(
      await resumed.evaluate(
        async () =>
          (await (await import(String("/module.js"))).listBookingIntents())
            .length,
      ),
      16,
    );
  } finally {
    await context.close();
  }
});

test("explicit clear retains credentials unless fenced and owns its pair across acknowledgement", async () => {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    assert.equal(
      await page.evaluate(async () => {
        const storage = await import(String("/module.js"));
        const pair = await storage.allocateBookingIntent();
        const before = JSON.stringify(await storage.listBookingIntents());
        const committed = await storage.clearRetainedBookingIntent(
          pair,
          async () => ({ state: "committed" }),
        );
        if (
          committed.state !== "committed" ||
          JSON.stringify(await storage.listBookingIntents()) !== before
        )
          return false;
        for (const response of [
          {},
          { state: "fenced", extra: true },
          Object.assign([], { state: "fenced" }),
        ]) {
          try {
            await storage.clearRetainedBookingIntent(
              pair,
              async () => response,
            );
            return false;
          } catch (error) {
            if (
              (error as Error).message !== "intent_clear_unresolved" ||
              "cause" in (error as Error)
            )
              return false;
          }
          if (JSON.stringify(await storage.listBookingIntents()) !== before)
            return false;
        }
        let unknown = false;
        try {
          await storage.clearRetainedBookingIntent(pair, async () => {
            throw new Error("private");
          });
        } catch (error) {
          unknown =
            (error as Error).message === "intent_clear_unresolved" &&
            !("cause" in (error as Error));
        }
        if (
          !unknown ||
          JSON.stringify(await storage.listBookingIntents()) !== before
        )
          return false;
        const caller = { ...pair };
        let acknowledge: (value: unknown) => void = () => {};
        const acknowledgement = new Promise((resolve) => {
          acknowledge = resolve;
        });
        const clearing = storage.clearRetainedBookingIntent(
          caller,
          async (copy: typeof pair) => {
            copy.credential = "b".repeat(64);
            return acknowledgement;
          },
        );
        caller.operationId = "22222222-2222-4222-8222-222222222222";
        caller.credential = "c".repeat(64);
        if (JSON.stringify(await storage.listBookingIntents()) !== before)
          return false;
        acknowledge({ state: "fenced" });
        const result = await clearing;
        return (
          result.state === "fenced" &&
          (await storage.listBookingIntents()).length === 0
        );
      }),
      true,
    );
  } finally {
    await context.close();
  }
});

test("delayed duplicate fences never recreate records or consume another tab's released capacity", async () => {
  const context = await browser.newContext();
  try {
    const first = await newPage(context);
    const second = await newPage(context);
    const delayed = first.evaluate(async () => {
      const storage = await import(String("/module.js"));
      for (let i = 0; i < 16; i++) await storage.allocateBookingIntent();
      const pair = (await storage.listBookingIntents())[0];
      await storage.clearRetainedBookingIntent(
        pair,
        () =>
          new Promise((resolve) => {
            (
              globalThis as unknown as { releaseFence: () => void }
            ).releaseFence = () => resolve({ state: "fenced" });
          }),
      );
      const after = await storage.listBookingIntents();
      return (
        after.length === 16 &&
        !after.some(
          (record: { operationId: string }) =>
            record.operationId === pair.operationId,
        )
      );
    });
    await first.waitForFunction(
      () =>
        typeof (globalThis as unknown as { releaseFence?: unknown })
          .releaseFence === "function",
    );
    assert.equal(
      await second.evaluate(async () => {
        const storage = await import(String("/module.js"));
        const pair = (await storage.listBookingIntents())[0];
        const results = await Promise.all([
          storage.clearRetainedBookingIntent(pair, async () => ({
            state: "fenced",
          })),
          storage.clearRetainedBookingIntent(pair, async () => ({
            state: "fenced",
          })),
        ]);
        if (
          !results.every(
            (result: { state: string }) => result.state === "fenced",
          )
        )
          return false;
        await storage.allocateBookingIntent();
        try {
          await storage.allocateBookingIntent();
          return false;
        } catch (error) {
          return (error as Error).message === "intent_capacity_reached";
        }
      }),
      true,
    );
    await first.evaluate(() =>
      (globalThis as unknown as { releaseFence: () => void }).releaseFence(),
    );
    assert.equal(await delayed, true);
  } finally {
    await context.close();
  }
});

for (const fault of [
  "delete-abort",
  "clear-relaxed",
  "wrong-credential",
] as const) {
  test(`${fault} retains the pair after fencing and permits safe retry`, async () => {
    const context = await browser.newContext();
    try {
      const page = await newPage(context);
      assert.equal(
        await page.evaluate(async (fault) => {
          const storage = await import(String("/module.js"));
          const pair = await storage.allocateBookingIntent();
          const before = JSON.stringify(await storage.listBookingIntents());
          const remove = IDBObjectStore.prototype.delete;
          const durability = Object.getOwnPropertyDescriptor(
            IDBTransaction.prototype,
            "durability",
          );
          if (fault === "delete-abort")
            IDBObjectStore.prototype.delete = function (...args) {
              const request = remove.apply(this, args);
              request.addEventListener("success", () =>
                this.transaction.abort(),
              );
              return request;
            };
          if (fault === "clear-relaxed")
            Object.defineProperty(IDBTransaction.prototype, "durability", {
              configurable: true,
              get: () => "relaxed",
            });
          let refused = false;
          try {
            await storage.clearRetainedBookingIntent(
              fault === "wrong-credential"
                ? {
                    ...pair,
                    credential:
                      pair.credential === "a".repeat(64)
                        ? "b".repeat(64)
                        : "a".repeat(64),
                  }
                : pair,
              async () => ({ state: "fenced" }),
            );
          } catch (error) {
            refused =
              (error as Error).message === "intent_storage_unavailable" &&
              !("cause" in (error as Error));
          } finally {
            IDBObjectStore.prototype.delete = remove;
            if (durability)
              Object.defineProperty(
                IDBTransaction.prototype,
                "durability",
                durability,
              );
          }
          if (
            !refused ||
            JSON.stringify(await storage.listBookingIntents()) !== before
          )
            return false;
          await storage.clearRetainedBookingIntent(pair, async () => ({
            state: "fenced",
          }));
          return (await storage.listBookingIntents()).length === 0;
        }, fault),
        true,
      );
    } finally {
      await context.close();
    }
  });
}

for (const fault of [
  "add-abort",
  "read-abort",
  "relaxed",
  "quota",
  "collision",
  "credential-collision",
] as const) {
  test(`${fault} fails closed without changing retained records`, async () => {
    const context = await browser.newContext();
    try {
      const page = await newPage(context);
      assert.deepEqual(
        await page.evaluate(async (fault) => {
          const storage = await import(String("/module.js"));
          const original = await storage.allocateBookingIntent();
          const initial = await storage.listBookingIntents();
          const pairPersisted =
            initial.length === 1 &&
            initial[0].operationId === original.operationId &&
            initial[0].credential === original.credential;
          const saved = JSON.stringify(initial);
          const add = IDBObjectStore.prototype.add;
          const getAll = IDBObjectStore.prototype.getAll;
          const durability = Object.getOwnPropertyDescriptor(
            IDBTransaction.prototype,
            "durability",
          );
          const uuid = crypto.randomUUID;
          const randomDescriptor = Object.getOwnPropertyDescriptor(
            crypto,
            "getRandomValues",
          );
          if (fault === "credential-collision")
            Object.defineProperty(crypto, "getRandomValues", {
              configurable: true,
              value: (array: Uint8Array) => {
                array.set(
                  original.credential
                    .match(/../g)
                    .map((hex: string) => Number.parseInt(hex, 16)),
                );
                return array;
              },
            });
          if (fault === "collision")
            crypto.randomUUID = () => original.operationId;
          if (fault === "relaxed")
            Object.defineProperty(IDBTransaction.prototype, "durability", {
              configurable: true,
              get: () => "relaxed",
            });
          if (fault === "add-abort" || fault === "quota") {
            IDBObjectStore.prototype.add = function (...args) {
              if (fault === "quota")
                throw new DOMException("private detail", "QuotaExceededError");
              const request = add.apply(this, args);
              request.addEventListener("success", () =>
                this.transaction.abort(),
              );
              return request;
            };
          }
          if (fault === "read-abort") {
            IDBObjectStore.prototype.getAll = function (...args) {
              const request = getAll.apply(this, args);
              request.addEventListener("success", () =>
                this.transaction.abort(),
              );
              return request;
            };
          }
          let safeFailure = false;
          try {
            await (fault === "read-abort"
              ? storage.listBookingIntents()
              : storage.allocateBookingIntent());
          } catch (error) {
            safeFailure =
              (error as Error).message === "intent_storage_unavailable" &&
              !(error as Error).cause;
          } finally {
            IDBObjectStore.prototype.add = add;
            IDBObjectStore.prototype.getAll = getAll;
            if (durability)
              Object.defineProperty(
                IDBTransaction.prototype,
                "durability",
                durability,
              );
            crypto.randomUUID = uuid;
            if (randomDescriptor)
              Object.defineProperty(
                crypto,
                "getRandomValues",
                randomDescriptor,
              );
            else Reflect.deleteProperty(crypto, "getRandomValues");
          }
          return {
            pairPersisted,
            safeFailure,
            unchanged:
              saved === JSON.stringify(await storage.listBookingIntents()),
          };
        }, fault),
        { pairPersisted: true, safeFailure: true, unchanged: true },
      );
    } finally {
      await context.close();
    }
  });
}

for (const fault of [
  "corrupt",
  "oversize",
  "schema",
  "version",
  "blocked",
] as const) {
  test(
    `${fault} storage is refused without repair or eviction`,
    { timeout: 10000 },
    async () => {
      const context = await browser.newContext();
      try {
        const page = await newPage(context);
        assert.equal(
          await page.evaluate(async (fault) => {
            const storage = await import(String("/module.js"));
            const name = "slotwell-booking-intents";
            if (fault === "corrupt" || fault === "oversize")
              await storage.allocateBookingIntent();
            const held = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(name, fault === "version" ? 2 : 1);
              request.onupgradeneeded = () => {
                if (fault === "schema")
                  request.result.createObjectStore("wrong");
              };
              request.onerror = () => reject(new Error("fixture open failed"));
              request.onsuccess = () => resolve(request.result);
            });
            if (fault === "corrupt" || fault === "oversize") {
              await new Promise<void>((resolve, reject) => {
                const tx = held.transaction("intents", "readwrite");
                if (fault === "corrupt")
                  tx.objectStore("intents").add({
                    operationId: "invalid",
                    credential: "invalid",
                    contact: "synthetic fixture",
                  });
                else
                  for (let n = 0; n < 16; n++)
                    tx.objectStore("intents").add({
                      operationId: crypto.randomUUID(),
                      credential: n.toString(16).padStart(64, "0"),
                    });
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(new Error("fixture insert failed"));
              });
            }
            if (fault !== "blocked") held.close();
            // Force a genuine blocked upgrade with real IDB events; never use an application profile.
            const open = IDBFactory.prototype.open;
            if (fault === "blocked")
              IDBFactory.prototype.open = function (dbName) {
                return open.call(this, dbName, 2);
              };
            const safe = async (fn: () => Promise<unknown>) => {
              try {
                await fn();
                return false;
              } catch (error) {
                const expected =
                  fault === "oversize" && fn === storage.allocateBookingIntent
                    ? "intent_capacity_reached"
                    : "intent_storage_unavailable";
                return (
                  (error as Error).message === expected &&
                  !(error as Error).cause
                );
              }
            };
            // Only the head queued open gets blocked until the held connection closes.
            const allocationRefused = await safe(storage.allocateBookingIntent);
            held.close();
            IDBFactory.prototype.open = open;
            const outcomes = [
              allocationRefused,
              await safe(storage.listBookingIntents),
              await safe(() =>
                storage.clearRetainedBookingIntent(
                  {
                    operationId: "11111111-1111-4111-8111-111111111111",
                    credential: "a".repeat(64),
                  },
                  async () => ({ state: "fenced" }),
                ),
              ),
            ];
            // Late blocked requests must not leak handles preventing a future upgrade.
            if (fault === "blocked")
              await new Promise<void>((resolve, reject) => {
                const next = indexedDB.open(name, 3);
                next.onsuccess = () => {
                  next.result.close();
                  resolve();
                };
                next.onerror = () =>
                  reject(new Error("late request cleanup failed"));
              });
            return outcomes.every(Boolean);
          }, fault),
          true,
        );
      } finally {
        await context.close();
      }
    },
  );
}

test("invalid pairs and acknowledgement getters cannot trigger local clearing", async () => {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    assert.equal(
      await page.evaluate(async () => {
        const storage = await import(String("/module.js"));
        const pair = await storage.allocateBookingIntent();
        let called = false;
        const malformed = { ...pair, credential: 123 };
        for (const input of [
          malformed,
          Object.assign([], pair),
          {
            get operationId() {
              throw new Error("private");
            },
            credential: pair.credential,
          },
        ]) {
          try {
            await storage.clearRetainedBookingIntent(input, async () => {
              called = true;
              return { state: "fenced" };
            });
            return false;
          } catch (error) {
            if ((error as Error).message !== "intent_clear_unresolved")
              return false;
          }
        }
        if (called) return false;
        try {
          await storage.clearRetainedBookingIntent(pair, async () => ({
            get state() {
              throw new Error("private");
            },
          }));
          return false;
        } catch (error) {
          if (
            (error as Error).message !== "intent_clear_unresolved" ||
            "cause" in (error as Error)
          )
            return false;
        }
        return (await storage.listBookingIntents()).length === 1;
      }),
      true,
    );
  } finally {
    await context.close();
  }
});

test("unavailable IndexedDB fails generically without a fallback", async () => {
  const context = await browser.newContext();
  try {
    const page = await newPage(context);
    assert.deepEqual(
      await page.evaluate(async () => {
        Object.defineProperty(globalThis, "indexedDB", {
          get() {
            throw new Error("private detail");
          },
        });
        const storage = await import(String("/module.js"));
        return Promise.all(
          [storage.allocateBookingIntent, storage.listBookingIntents].map(
            async (fn) => {
              try {
                await fn();
                return false;
              } catch (error) {
                return (
                  (error as Error).message === "intent_storage_unavailable" &&
                  !(error as Error).cause
                );
              }
            },
          ),
        );
      }),
      [true, true],
    );
  } finally {
    await context.close();
  }
});
