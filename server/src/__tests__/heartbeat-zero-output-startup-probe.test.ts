import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({
  track: vi.fn(),
  hashPrivateRef: vi.fn(() => "test-private-reference"),
}));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

import {
  ADAPTER_NO_OUTPUT_ERROR_CODE,
  ZERO_OUTPUT_STARTUP_PROBE_MS,
  clearTerminalRunIssueLocks,
  heartbeatService,
} from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres zero-output startup probe tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

const RESPONSIBLE_USER_ID = "responsible-user";

describeEmbeddedPostgres("heartbeat zero-output startup probe", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-zero-output-probe-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    mockTelemetryClient.track.mockClear();
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // Seeds the minimum rows the wake-queue release needs to resolve a
  // responsible user, mirroring the orphan-reaper test fixture.
  async function seed(input: {
    runtimeMode?: "legacy" | "native";
    processStartedAt?: Date | null;
    lastOutputAt?: Date | null;
    lastOutputSeq?: number;
    runStatus?: string;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      defaultResponsibleUserId: RESPONSIBLE_USER_ID,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenCodeCoder",
      role: "engineer",
      status: "idle",
      adapterType: "opencode_local",
      adapterConfig: { model: "opencode/mimo-v2.6-flash-free" },
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      status: "claimed",
      runId,
      claimedAt: new Date(),
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: input.runStatus ?? "running",
      wakeupRequestId,
      contextSnapshot: { issueId },
      runtimeMode: input.runtimeMode ?? "legacy",
      processStartedAt: input.processStartedAt === undefined ? null : input.processStartedAt,
      lastOutputAt: input.lastOutputAt === undefined ? null : input.lastOutputAt,
      lastOutputSeq: input.lastOutputSeq ?? 0,
      responsibleUserId: RESPONSIBLE_USER_ID,
      startedAt: new Date(),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Zero-output probe",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
      executionLockedAt: new Date(),
      responsibleUserId: RESPONSIBLE_USER_ID,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    return { companyId, agentId, runId, wakeupRequestId, issueId };
  }

  it("fails a run that produced no output past the probe window and releases its lock", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { runId, issueId } = await seed({
      processStartedAt: new Date(now.getTime() - ZERO_OUTPUT_STARTUP_PROBE_MS - 1_000),
    });

    const result = await heartbeatService(db).failZeroOutputRuns({
      now,
      probeMs: ZERO_OUTPUT_STARTUP_PROBE_MS,
    });

    expect(result.failed).toBe(1);
    expect(result.runIds).toEqual([runId]);

    const run = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0]);
    expect(run).toEqual({ status: "failed", errorCode: ADAPTER_NO_OUTPUT_ERROR_CODE });

    const lock = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(lock).toEqual({
      checkoutRunId: null,
      executionRunId: null,
      executionLockedAt: null,
    });

    const events = await db
      .select({ message: heartbeatRunEvents.message })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runId));
    expect(events.map((event) => event.message)).toContain(
      "run failed: no adapter output after startup probe window",
    );
  });

  it("leaves a fresh zero-output run alone", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { runId, issueId } = await seed({
      processStartedAt: new Date(now.getTime() - ZERO_OUTPUT_STARTUP_PROBE_MS / 2),
    });

    const result = await heartbeatService(db).failZeroOutputRuns({
      now,
      probeMs: ZERO_OUTPUT_STARTUP_PROBE_MS,
    });

    expect(result).toEqual({ scanned: 0, failed: 0, runIds: [] });
    await expect(
      db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)),
    ).resolves.toEqual([{ status: "running" }]);
    await expect(
      db.select({ checkoutRunId: issues.checkoutRunId }).from(issues).where(eq(issues.id, issueId)),
    ).resolves.toEqual([{ checkoutRunId: runId }]);
  });

  it("leaves a run that has already emitted output alone", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { runId } = await seed({
      processStartedAt: new Date(now.getTime() - ZERO_OUTPUT_STARTUP_PROBE_MS - 1_000),
      lastOutputAt: new Date(now.getTime() - ZERO_OUTPUT_STARTUP_PROBE_MS - 500),
      lastOutputSeq: 1,
    });

    const result = await heartbeatService(db).failZeroOutputRuns({
      now,
      probeMs: ZERO_OUTPUT_STARTUP_PROBE_MS,
    });

    expect(result).toEqual({ scanned: 0, failed: 0, runIds: [] });
    await expect(
      db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)),
    ).resolves.toEqual([{ status: "running" }]);
  });

  it("leaves a native run to its native finalization coordinator", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { runId } = await seed({
      runtimeMode: "native",
      processStartedAt: new Date(now.getTime() - ZERO_OUTPUT_STARTUP_PROBE_MS - 1_000),
    });

    const result = await heartbeatService(db).failZeroOutputRuns({
      now,
      probeMs: ZERO_OUTPUT_STARTUP_PROBE_MS,
    });

    expect(result).toEqual({ scanned: 1, failed: 0, runIds: [] });
    await expect(
      db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)),
    ).resolves.toEqual([{ status: "running" }]);
  });

  describe("clearTerminalRunIssueLocks", () => {
    it("clears a lock that points at a terminal run", async () => {
      const { companyId, runId, issueId } = await seed({ runStatus: "running" });
      await db
        .update(heartbeatRuns)
        .set({ status: "timed_out", errorCode: "timeout" })
        .where(eq(heartbeatRuns.id, runId));

      const cleared = await clearTerminalRunIssueLocks(db, {
        id: runId,
        companyId,
        status: "timed_out",
      });

      expect(cleared).toEqual([issueId]);
      await expect(
        db
          .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
          .from(issues)
          .where(eq(issues.id, issueId)),
      ).resolves.toEqual([{ checkoutRunId: null, executionRunId: null }]);
    });

    it("never clears a lock while the referenced run is still live", async () => {
      const { companyId, runId, issueId } = await seed({ runStatus: "running" });

      const cleared = await clearTerminalRunIssueLocks(db, {
        id: runId,
        companyId,
        status: "running",
      });

      expect(cleared).toEqual([]);
      await expect(
        db
          .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
          .from(issues)
          .where(eq(issues.id, issueId)),
      ).resolves.toEqual([{ checkoutRunId: runId, executionRunId: runId }]);
    });

    it("re-checks the run status so a stale snapshot cannot clear a live lock", async () => {
      const { companyId, runId, issueId } = await seed({ runStatus: "running" });

      // The caller believes the run is terminal, but the row is still running.
      const cleared = await clearTerminalRunIssueLocks(db, {
        id: runId,
        companyId,
        status: "failed",
      });

      expect(cleared).toEqual([]);
      await expect(
        db
          .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
          .from(issues)
          .where(eq(issues.id, issueId)),
      ).resolves.toEqual([{ checkoutRunId: runId, executionRunId: runId }]);
    });
  });
});
