import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { services, staff } from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import app from "@/server/app";
import type { BusinessView, ServiceView, StaffView } from "@/server/catalog";

type ResponseBody = {
  business?: BusinessView;
  services?: ServiceView[];
  staff?: StaffView[];
  error?: { code: string; max?: number; serviceIds?: string[] };
};

async function get(db: NodePgDatabase, path: string) {
  const res = await app.request(`/api${path}`, {}, { db });
  return { status: res.status, body: (await res.json()) as ResponseBody };
}

function keys(value: object): string[] {
  return Object.keys(value).sort();
}

test("/api/health answers without a database binding", async () => {
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("/api/catalog exposes the allowlisted business and active services in order", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    const { status, body } = await get(db, "/catalog");
    assert.equal(status, 200);
    assert.deepEqual(keys(body), ["business", "services"]);
    assert.deepEqual(body.business, {
      name: "Студио за красота Нюанс",
      address: "ул. „Шипка“ 18, София",
      timeZone: "Europe/Sofia",
      currency: "EUR",
    });
    assert.equal(body.services?.length, 12);
    // Ordered by sort_order; first seeded service and its allowlisted fields.
    assert.deepEqual(body.services?.[0], {
      id: "cut_w",
      name: "Дамско подстригване",
      category: "Коса",
      priceCents: 2800,
      durationMinutes: 45,
    });
    const keratin = body.services?.find((s) => s.id === "keratin");
    assert.equal(keratin?.priceCents, null);
    // No record internals leak into any service object.
    for (const service of body.services ?? []) {
      assert.deepEqual(keys(service), [
        "category",
        "durationMinutes",
        "id",
        "name",
        "priceCents",
      ]);
    }
  });
});

test("/api/catalog omits deactivated services", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    await db.insert(services).values({
      id: "retired",
      name: "Спряна услуга",
      category: "Коса",
      currency: "EUR",
      durationMinutes: 30,
      cleanupMinutes: 0,
      sortOrder: 99,
      isActive: false,
    });
    const { body } = await get(db, "/catalog");
    assert.equal(body.services?.length, 12);
    assert.ok(!body.services?.some((s) => s.id === "retired"));
  });
});

test("/api/staff returns qualified active staff for one service, ordered", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    const hair = await get(db, "/staff?service=cut_w");
    assert.equal(hair.status, 200);
    assert.deepEqual(
      hair.body.staff?.map((s) => s.id),
      ["mimi", "pavel"],
    );
    assert.deepEqual(keys(hair.body.staff?.[0] ?? {}), [
      "description",
      "id",
      "imageUrl",
      "name",
    ]);
    assert.equal(hair.body.staff?.[0]?.imageUrl, "/staff/mimi-ibramova.jpg");

    const massage = await get(db, "/staff?service=massage_relax");
    assert.deepEqual(
      massage.body.staff?.map((s) => s.id),
      ["emil"],
    );
  });
});

test("/api/staff intersects multiple services and returns empty when none qualify", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    const bothHair = await get(db, "/staff?service=cut_w&service=beard");
    assert.deepEqual(
      bothHair.body.staff?.map((s) => s.id),
      ["mimi", "pavel"],
    );
    // No single staff member performs both a hair and a massage service.
    const mixed = await get(db, "/staff?service=cut_w&service=massage_relax");
    assert.equal(mixed.status, 200);
    assert.deepEqual(mixed.body.staff, []);
  });
});

test("/api/staff excludes a deactivated staff member", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    await db
      .update(staff)
      .set({ isActive: false })
      .where(eq(staff.id, "pavel"));
    const { body } = await get(db, "/staff?service=cut_w");
    assert.deepEqual(
      body.staff?.map((s) => s.id),
      ["mimi"],
    );
  });
});

test("/api/staff rejects malformed selections with stable error codes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);

    const missing = await get(db, "/staff");
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { error: { code: "services_required" } });

    const many = Array.from({ length: 21 }, (_, i) => `svc${i}`)
      .map((id) => `service=${id}`)
      .join("&");
    const tooMany = await get(db, `/staff?${many}`);
    assert.equal(tooMany.status, 400);
    assert.deepEqual(tooMany.body, {
      error: { code: "too_many_services", max: 20 },
    });

    const longId = "x".repeat(65);
    const invalid = await get(db, `/staff?service=${longId}`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, { error: { code: "invalid_service_id" } });

    const dup = await get(db, "/staff?service=cut_w&service=cut_w");
    assert.equal(dup.status, 400);
    assert.deepEqual(dup.body, {
      error: { code: "duplicate_services", serviceIds: ["cut_w"] },
    });

    const unknown = await get(db, "/staff?service=cut_w&service=ghost");
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body, {
      error: { code: "unknown_services", serviceIds: ["ghost"] },
    });
  });
});

test("/api/staff folds a deactivated service into unknown_services", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await seedCatalog(db);
    await db
      .update(services)
      .set({ isActive: false })
      .where(eq(services.id, "keratin"));
    const { status, body } = await get(db, "/staff?service=keratin");
    assert.equal(status, 400);
    assert.deepEqual(body, {
      error: { code: "unknown_services", serviceIds: ["keratin"] },
    });
  });
});
