// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentDetail, AgentRuntimeState, HeartbeatRun, Issue } from "@paperclipai/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentOverview } from "./AgentDetail";

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div>{children}</div>,
}));

function makeHeartbeatRun(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  const timestamp = new Date("2026-08-31T12:00:00Z");

  return {
    id: "run-opencode-1",
    companyId: "company-1",
    agentId: "agent-opencode",
    invocationSource: "on_demand",
    triggerDetail: "manual",
    status: "succeeded",
    responsibleUserId: null,
    startedAt: timestamp,
    finishedAt: timestamp,
    error: null,
    wakeupRequestId: null,
    exitCode: 0,
    signal: null,
    usageJson: null,
    resultJson: { summary: "The run completed successfully." },
    sessionIdBefore: null,
    sessionIdAfter: null,
    logStore: null,
    logRef: null,
    logBytes: null,
    logSha256: null,
    logCompressed: false,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    errorCode: null,
    externalRunId: null,
    processPid: null,
    processStartedAt: null,
    lastOutputAt: timestamp,
    lastOutputSeq: 0,
    lastOutputStream: null,
    lastOutputBytes: null,
    retryOfRunId: null,
    processLossRetryCount: 0,
    livenessState: "completed",
    livenessReason: null,
    continuationAttempt: 0,
    lastUsefulActionAt: timestamp,
    nextAction: null,
    contextSnapshot: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("AgentOverview", () => {
  it("prioritizes identity, capability, runtime, skills, tasks, and scoped Audit entry points", () => {
    const agent = {
      id: "agent-1",
      companyId: "company-1",
      name: "Codex Coder",
      urlKey: "codexcoder",
      role: "engineer",
      title: "Product engineer",
      status: "active",
      reportsTo: null,
      capabilities: "Builds and verifies product changes.",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.6-sol" },
      runtimeConfig: {},
      chainOfCommand: [],
      access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] },
    } as unknown as AgentDetail;
    const issue = {
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-42",
      title: "Simplify agent information architecture",
      status: "in_progress",
      priority: "high",
      updatedAt: new Date("2026-08-31T12:00:00Z"),
    } as unknown as Issue;
    const runtime = {
      sessionDisplayId: "codex-session-42",
    } as unknown as AgentRuntimeState;

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AgentOverview
          agent={agent}
          runs={[] as HeartbeatRun[]}
          assignedIssues={[issue]}
          runtimeState={runtime}
          directReportCount={2}
          skillNames={["Design Guide", "Check PR"]}
          agentRouteId="codexcoder"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("Identity");
    expect(markup).toContain("Capabilities");
    expect(markup).toContain("Harness / Runtime");
    expect(markup).toContain("Design Guide");
    expect(markup).toContain("Simplify agent information architecture");
    expect(markup).toContain("PAP-42");
    expect(markup).toContain('href="/activity/costs?agentId=agent-1"');
    expect(markup).not.toContain("Run Activity");
    expect(markup).not.toContain("Tasks by Status");
  });
  it("surfaces read-only runtime details and redacts configured command secrets", () => {
    const agent = {
      id: "agent-opencode",
      companyId: "company-1",
      name: "OpenCode Coder",
      urlKey: "opencodecoder",
      role: "engineer",
      title: null,
      status: "active",
      reportsTo: null,
      capabilities: "",
      adapterType: "opencode_local",
      adapterConfig: {
        model: "openrouter/anthropic/claude-sonnet-5",
        command: "opencode run --api-key=top-secret",
        cwd: "/workspace/project",
      },
      runtimeConfig: {},
      chainOfCommand: [],
      access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] },
    } as unknown as AgentDetail;
    const run: HeartbeatRun = makeHeartbeatRun();

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AgentOverview
          agent={agent}
          runs={[run]}
          assignedIssues={[] as Issue[]}
          directReportCount={0}
          skillNames={[]}
          agentRouteId="opencodecoder"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("Status");
    expect(markup).toContain("Provider");
    expect(markup).toContain("openrouter");
    expect(markup).toContain("Command");
    expect(markup).toContain("opencode run --api-key=***REDACTED***");
    expect(markup).not.toContain("top-secret");
    expect(markup).toContain("/workspace/project");
    expect(markup).toContain("succeeded");
  });
});
