type AssociationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storageKey = "slotwell-booking-intent-locator";
const unavailable = () => new Error("intent_association_unavailable");

function requireLocator(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw unavailable();
}

function readFrom(storage: AssociationStorage): string | null {
  const value = storage.getItem(storageKey);
  if (value !== null) requireLocator(value);
  return value;
}

/** A locator hint, never intent ownership or lifecycle authorization. */
export function createIntentAssociation(
  getStorage: () => AssociationStorage = () => window.sessionStorage,
) {
  function access<T>(operation: (storage: AssociationStorage) => T): T {
    try {
      return operation(getStorage());
    } catch {
      throw unavailable();
    }
  }
  return {
    read: () => access(readFrom),
    write(nextLocator: string, expectedPrevious: string | null) {
      requireLocator(nextLocator);
      if (expectedPrevious !== null) requireLocator(expectedPrevious);
      access((storage) => {
        if (readFrom(storage) !== expectedPrevious) throw unavailable();
        storage.setItem(storageKey, nextLocator);
      });
    },
    remove(expectedLocator: string) {
      requireLocator(expectedLocator);
      access((storage) => {
        const current = readFrom(storage);
        if (current === null) return;
        if (current !== expectedLocator) throw unavailable();
        storage.removeItem(storageKey);
      });
    },
  };
}
