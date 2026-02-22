import { beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { organizations } from "@db/schema";
import { withRLSTransaction, withoutRLSTransaction } from "../helpers/rls";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
});

describe("GET /api/organizations/:id", () => {
  test("admin can get own organization", async () => {
    const headers = await authHeadersFor(s.orgAAdmin);
    const response = await request(`/api/organizations/${s.orgA.id}`, {
      headers,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(s.orgA.id);
    expect(body.name).toBe(s.orgA.name);
    expect(body.slug).toBe(s.orgA.slug);
  });

  test("support can get own organization", async () => {
    const headers = await authHeadersFor(s.orgASupport);
    const response = await request(`/api/organizations/${s.orgA.id}`, {
      headers,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(s.orgA.id);
  });

  test("returns 404 for non-existent org", async () => {
    const fakeOrgId = "00000000-0000-0000-0000-000000000000";
    const headers = await authHeadersFor(s.orgAAdmin);
    const response = await request(`/api/organizations/${fakeOrgId}`, {
      headers,
    });
    expect(response.status).toBe(404);
  });

  test("requesting different org returns 404 (RLS prevents access)", async () => {
    const headers = await authHeadersFor(s.orgAAdmin);
    const response = await request(`/api/organizations/${s.orgB.id}`, {
      headers,
    });
    expect(response.status).toBe(404);
  });

  test("returns 401 without auth", async () => {
    const response = await request(`/api/organizations/${s.orgA.id}`);
    expect(response.status).toBe(401);
  });
});

describe("Organizations RLS (database-level)", () => {
  test("forOrg(orgA) can only see org A", async () => {
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(s.orgA.id);
  });

  test("forOrg(orgB) can only see org B", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(s.orgB.id);
  });

  test("without RLS context, no organizations returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(0);
  });
});
