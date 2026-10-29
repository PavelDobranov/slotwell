export type RetainedBookingIntent = {
  operationId: string;
  credential: string;
};

const databaseName = "slotwell-booking-intents";
const storeName = "intents";
const capacity = 16;
const unavailable = () => new Error("intent_storage_unavailable");

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const request = indexedDB.open(databaseName, 1);
    request.onblocked = () => {
      refused = true;
      reject(unavailable());
    };
    request.onerror = () => reject(unavailable());
    request.onupgradeneeded = (event) => {
      if (refused || event.oldVersion !== 0) {
        request.transaction?.abort();
        return;
      }
      const store = request.result.createObjectStore(storeName, {
        keyPath: "operationId",
      });
      store.createIndex("credential", "credential", { unique: true });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (refused) db.close();
      else resolve(db);
    };
  });
}

function isIntent(value: unknown): value is RetainedBookingIntent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "credential,operationId" &&
    typeof record.operationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      record.operationId,
    ) &&
    typeof record.credential === "string" &&
    /^[0-9a-f]{64}$/.test(record.credential)
  );
}

type StorageAction = "list" | "allocate" | { clear: RetainedBookingIntent };

async function transact(
  action: StorageAction,
): Promise<RetainedBookingIntent[]> {
  const allocate = action === "allocate";
  const write = action !== "list";
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    throw unavailable();
  }
  try {
    return await new Promise<RetainedBookingIntent[]>((resolve, reject) => {
      let failure = "intent_storage_unavailable";
      let result: RetainedBookingIntent[] = [];
      const tx = db.transaction(storeName, write ? "readwrite" : "readonly", {
        durability: "strict",
      });
      tx.onabort = () => reject(new Error(failure));
      tx.onerror = () => {
        /* Abort is the terminal failure event. */
      };
      tx.oncomplete = () => resolve(result);
      try {
        const store = tx.objectStore(storeName);
        const index = store.index("credential");
        if (
          db.objectStoreNames.length !== 1 ||
          store.keyPath !== "operationId" ||
          store.autoIncrement ||
          store.indexNames.length !== 1 ||
          index.keyPath !== "credential" ||
          !index.unique ||
          index.multiEntry ||
          (write && tx.durability !== "strict")
        ) {
          tx.abort();
          return;
        }
        // Bounded read; no silent repair/eviction of malformed or excess records.
        const read = store.getAll(undefined, capacity + 1);
        read.onsuccess = () => {
          try {
            const records: unknown[] = read.result;
            if (!records.every(isIntent)) {
              tx.abort();
              return;
            }
            if (records.length >= capacity && allocate) {
              failure = "intent_capacity_reached";
              tx.abort();
              return;
            }
            if (records.length > capacity) {
              tx.abort();
              return;
            }
            result = records as RetainedBookingIntent[];
            if (typeof action === "object") {
              const existing = result.find(
                ({ operationId }) => operationId === action.clear.operationId,
              );
              if (existing && existing.credential !== action.clear.credential) {
                tx.abort();
                return;
              }
              if (existing) store.delete(existing.operationId);
              result = [];
            } else if (allocate) {
              const intent = {
                operationId: crypto.randomUUID(),
                credential: Array.from(
                  crypto.getRandomValues(new Uint8Array(32)),
                  (byte) => byte.toString(16).padStart(2, "0"),
                ).join(""),
              };
              store.add(intent);
              result = [intent];
            }
          } catch {
            tx.abort();
          }
        };
      } catch {
        tx.abort();
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "intent_capacity_reached")
      throw error;
    throw unavailable();
  } finally {
    db.close();
  }
}

/** A fresh intent, not a retry. Await completion BEFORE any registration/networking. */
export async function allocateBookingIntent(): Promise<RetainedBookingIntent> {
  return (await transact("allocate"))[0];
}

/** Discovery only: no server lifecycle or permission to remove/replace is implied. */
export async function listBookingIntents(): Promise<RetainedBookingIntent[]> {
  return transact("list");
}

/** Explicit clear only. The trusted callback authenticates this exact pair and
 * acknowledges only after the server's owning fence transaction commits.
 * No IndexedDB transaction spans networking. Committed never authorizes deletion.
 */
export async function clearRetainedBookingIntent(
  intent: RetainedBookingIntent,
  requestFence: (pair: RetainedBookingIntent) => Promise<unknown>,
): Promise<{ state: "fenced" | "committed" }> {
  let pair: RetainedBookingIntent;
  let state: "fenced" | "committed";
  try {
    if (Array.isArray(intent)) throw new Error();
    pair = { ...intent };
    if (!isIntent(pair)) throw new Error();
    const acknowledgement = await requestFence({ ...pair });
    if (
      !acknowledgement ||
      typeof acknowledgement !== "object" ||
      Array.isArray(acknowledgement) ||
      Object.keys(acknowledgement).join(",") !== "state"
    )
      throw new Error();
    const value = (acknowledgement as { state?: unknown }).state;
    if (value !== "fenced" && value !== "committed") throw new Error();
    state = value;
  } catch {
    throw new Error("intent_clear_unresolved");
  }
  if (state === "fenced") await transact({ clear: pair });
  return { state };
}
