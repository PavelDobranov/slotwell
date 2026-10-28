// Pure service-selection bounds shared by catalog, availability, and booking.
//
// Transport-independent: this module knows nothing of HTTP status codes, Hono,
// the catalog capability, or database tables. It owns the selection policy once
// (count bound, identifier length bound, de-duplication, ordering) so no caller
// re-implements it. Each caller translates `ServiceSelectionError` into its own
// transport failure — the catalog capability maps every branch to a 400 with an
// identical response body.

// Bound the selected-service request. M1 seeds 12 services; 20 leaves headroom
// without accepting unbounded selections.
export const MAX_SELECTED_SERVICES = 20;
const MAX_SERVICE_ID_LENGTH = 64;

export type ServiceSelectionCode =
  | "services_required"
  | "too_many_services"
  | "invalid_service_id"
  | "duplicate_services";

/**
 * Stable, transport-independent selection failure. The `code` and the optional
 * `serviceIds`/`max` map directly onto the catalog error body; the rule never
 * chooses an HTTP status and never reveals which identifier is unknown — that
 * requires a database lookup the pure rule does not perform.
 */
export class ServiceSelectionError extends Error {
  readonly code: ServiceSelectionCode;
  readonly serviceIds?: string[];
  readonly max?: number;
  constructor(
    code: ServiceSelectionCode,
    extra?: { serviceIds?: string[]; max?: number },
  ) {
    super(code);
    this.code = code;
    this.serviceIds = extra?.serviceIds;
    this.max = extra?.max;
  }
}

/**
 * Validate a raw `service` array against the approved bounds. Pure, so callers
 * can reject malformed requests before resolving a database. On success returns
 * the input unchanged — same reference, order, and identity — so callers can
 * keep using the caller's own array.
 */
export function validateServiceSelection(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    throw new ServiceSelectionError("services_required");
  }
  if (raw.length > MAX_SELECTED_SERVICES) {
    throw new ServiceSelectionError("too_many_services", {
      max: MAX_SELECTED_SERVICES,
    });
  }
  if (raw.some((id) => id.length === 0 || id.length > MAX_SERVICE_ID_LENGTH)) {
    throw new ServiceSelectionError("invalid_service_id");
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of raw) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new ServiceSelectionError("duplicate_services", {
      serviceIds: [...duplicates],
    });
  }
  return raw;
}
