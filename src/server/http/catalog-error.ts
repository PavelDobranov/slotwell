import { CatalogError } from "@/server/catalog";
import { ServiceSelectionError } from "@/shared/service-selection";

// Catalog/availability application failures are machine-readable codes with no
// HTTP status. The adapter owns the mapping: the two infrastructure codes are
// 500, every other coded failure (including the shared selection rule's) is a
// 400, and anything unrecognized is an opaque 500 that discloses nothing.
const SERVER_ERROR_CODES = new Set([
  "catalog_unavailable",
  "availability_unavailable",
]);

type ErrorBody = {
  error: { code: string; serviceIds?: string[]; max?: number };
};

/** Translate a catalog/selection error into its stable HTTP status and body. */
export function catalogErrorResponse(error: unknown): {
  status: 400 | 500;
  body: ErrorBody;
} {
  if (error instanceof CatalogError || error instanceof ServiceSelectionError) {
    const body: ErrorBody = { error: { code: error.code } };
    if (error.serviceIds) body.error.serviceIds = error.serviceIds;
    if (error.max !== undefined) body.error.max = error.max;
    const status =
      error instanceof CatalogError && SERVER_ERROR_CODES.has(error.code)
        ? 500
        : 400;
    return { status, body };
  }
  return { status: 500, body: { error: { code: "internal" } } };
}
