import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { isUuidLike, isUuidShaped } from "@paperclipai/shared";
import { agentService } from "../services/agents.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent reference tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("isUuidShaped", () => {
  it("accepts UUID versions outside the RFC 4122 1-5 range", () => {
    expect(isUuidShaped("0190a1b2-c3d4-7abc-8def-0123456789ab")).toBe(true);
    expect(isUuidShaped("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuidShaped("0190a1b2-c3d4-6abc-8def-0123456789ab")).toBe(true);
    expect(isUuidShaped("0190a1b2-c3d4-7abc-cdef-0123456789ab")).toBe(true);
  });

  it("rejects slugs and malformed values", () => {
    expect(isUuidShaped("kryten")).toBe(false);
    expect(isUuidShaped("d4d620f8b0b84dcfad36a758db87b19e")).toBe(false);
    expect(isUuidShaped(null)).toBe(false);
  });

  it("stays stricter than isUuidLike so generation paths keep RFC 4122 semantics", () => {
    expect(isUuidLike("0190a1b2-c3d4-4abc-8def-0123456789ab")).toBe(true);
    expect(isUuidLike("0190a1b2-c3d4-7abc-8def-0123456789ab")).toBe(false);
  });
});

describeEmbeddedPostgres("agent resolveByReference", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-reference-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("resolves a non-RFC-4122 UUID agent id instead of reporting it as unknown", async () => {
    const companyId = randomUUID();
    // A v7-shaped id: valid PostgreSQL uuid, rejected by the RFC 4122 test.
    const agentId = "0190a1b2-c3d4-7abc-8def-0123456789ab";
    await db
      .insert(companies)
      .values({ id: companyId, name: "Reference", issuePrefix: "REF" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Kryten",
      role: "engineer",
      adapterType: "opencode_local",
      adapterConfig: {},
    });

    const resolved = await agentService(db).resolveByReference(companyId, agentId);

    expect(resolved.ambiguous).toBe(false);
    expect(resolved.agent?.id).toBe(agentId);
  });

  it("still refuses an id that belongs to another company", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const agentId = randomUUID();
    await db
      .insert(companies)
      .values([
        { id: companyId, name: "Home", issuePrefix: "HOM" },
        { id: otherCompanyId, name: "Other", issuePrefix: "OTH" },
      ]);
    await db.insert(agents).values({
      id: agentId,
      companyId: otherCompanyId,
      name: "Holly",
      role: "engineer",
      adapterType: "opencode_local",
      adapterConfig: {},
    });

    const resolved = await agentService(db).resolveByReference(companyId, agentId);

    expect(resolved.ambiguous).toBe(false);
    expect(resolved.agent).toBeNull();
  });

  it("keeps shortname resolution working", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db
      .insert(companies)
      .values({ id: companyId, name: "Shortname", issuePrefix: "SHR" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Rimmer",
      role: "engineer",
      adapterType: "opencode_local",
      adapterConfig: {},
    });

    const resolved = await agentService(db).resolveByReference(companyId, "rimmer");

    expect(resolved.ambiguous).toBe(false);
    expect(resolved.agent?.id).toBe(agentId);
  });
});