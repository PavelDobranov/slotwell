// Browser client for the catalog/staff reads exposed by @/server/catalog.
// The view types mirror that JSON contract but are declared here, not imported,
// so the client bundle pulls in no server-only database code.

export type BusinessView = {
  name: string;
  address: string;
  timeZone: string;
  currency: string;
  defaultPhoneCountry: string;
};
export type ServiceView = {
  id: string;
  name: string;
  category: string;
  priceCents: number | null;
  durationMinutes: number;
  cleanupMinutes: number;
  currency: string;
};
export type StaffView = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
};
export type CatalogView = {
  business: BusinessView;
  services: ServiceView[];
};

export type SlotView = { start: string; end: string };
export type AvailabilityView = {
  timeZone: string;
  serverNow: string;
  from: string;
  to: string;
  days: { date: string; slots: SlotView[] }[];
};
export type AvailabilityQuery = {
  staffId: string;
  serviceIds: readonly string[];
  from: string;
  to: string;
};

/** Stable machine-readable failure. `code` is the server's error code, or
 * "network" when the request never reached a response. */
export class CatalogApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly serviceIds?: string[];
  readonly max?: number;
  constructor(
    code: string,
    status: number,
    extra?: { serviceIds?: string[]; max?: number; cause?: unknown },
  ) {
    super(
      code,
      extra?.cause === undefined ? undefined : { cause: extra.cause },
    );
    this.name = "CatalogApiError";
    this.code = code;
    this.status = status;
    this.serviceIds = extra?.serviceIds;
    this.max = extra?.max;
  }
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    // An aborted request is the caller tearing down, not a surfaced failure.
    if (signal?.aborted) throw cause;
    throw new CatalogApiError("network", 0, { cause });
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; serviceIds?: string[]; max?: number };
    } | null;
    const error = body?.error;
    throw new CatalogApiError(error?.code ?? "internal", response.status, {
      serviceIds: error?.serviceIds,
      max: error?.max,
    });
  }
  return (await response.json()) as T;
}

/** Advisory server slots, passed through without client eligibility rules. */
export function fetchAvailability(
  query: AvailabilityQuery,
  signal?: AbortSignal,
): Promise<AvailabilityView> {
  const params = new URLSearchParams({
    staff: query.staffId,
    from: query.from,
    to: query.to,
  });
  for (const id of query.serviceIds) params.append("service", id);
  return requestJson<AvailabilityView>(`/api/availability?${params}`, signal);
}

/** Business identity plus active services, ordered for the picker. */
export function fetchCatalog(signal?: AbortSignal): Promise<CatalogView> {
  return requestJson<CatalogView>("/api/catalog", signal);
}

/** Active staff qualified for every selected active service. */
export async function fetchQualifiedStaff(
  serviceIds: readonly string[],
  signal?: AbortSignal,
): Promise<StaffView[]> {
  const params = new URLSearchParams();
  for (const id of serviceIds) params.append("service", id);
  const { staff } = await requestJson<{ staff: StaffView[] }>(
    `/api/staff?${params}`,
    signal,
  );
  return staff;
}
