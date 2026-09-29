import { describe, expect, it } from "vitest";
import { blockerScenario } from "./blocker-cases.js";
import { runnerMatrix } from "./catalog.js";
import { parseRunnerSelectors, selectRunnerExecutions } from "./selectors.js";
import { gradeBlocker, gradeBlockerInputUx, type BlockerCheckpoint } from "./blocker-scoring.js";
function fixture() {
  const waiting: BlockerCheckpoint = { phase: "waiting", issue: { id: "task", status: "in_review", assigneeAgentId: "worker", createdByUserId: "requester" },
    issues: [{ id: "task" }], agents: [{ id: "worker" }, { id: "manager" }], approvals: [], activity: [], comments: [],
    interactions: [{ id: "question", kind: "ask_user_questions", status: "pending", resolverPolicy: "human_only", addresseeUserId: "requester", continuationPolicy: "wake_assignee", payload: { prompt: "Clarify salary scope?" } }],
    runs: [{ id: "first", agentId: "worker", status: "succeeded", runtimeMode: "legacy" }] };
  const final: BlockerCheckpoint = { ...structuredClone(waiting), phase: "final", issue: { ...waiting.issue, status: "done" },
    comments: [{ authorAgentId: "worker", body: "DECISION_test" }],
    interactions: [{ ...waiting.interactions[0], status: "answered", resolvedByUserId: "requester", result: { text: "DECISION_test" } }],
    runs: [...waiting.runs, { ...waiting.runs[0], id: "second" }] };
  return { caseId: "requester-scope" as const, assigneeId: "worker", managerId: "manager", marker: "DECISION_test", checkpoints: [waiting, final] };
}
describe("blocker guidance oracle calibration", () => {
  it("uses an alphanumeric decision marker that rich Markdown cannot escape", () => {
    expect(blockerScenario("human-authority", "nonce-1").marker).toMatch(/^[A-Z0-9]+$/i);
  });
  it("accepts saved requester direction and completed continuation", () => expect(gradeBlocker(fixture()).every(c => c.passed)).toBe(true));
  it.each(["request_confirmation", "request_checkbox_confirmation"])("accepts human-only %s and browser scope change, reports UX separately", kind => {
    const f = fixture();
    f.checkpoints[0]!.interactions[0]!.kind = kind;
    f.checkpoints[1]!.interactions[0] = { ...f.checkpoints[0]!.interactions[0], status: "rejected", resolvedByUserId: "requester", result: { outcome: "rejected" } };
    f.checkpoints[1]!.comments.push({ id: "scope-change", authorUserId: "requester", body: f.marker });
    expect(gradeBlocker(f).every(c => c.passed)).toBe(true);
    expect(gradeBlockerInputUx(f.checkpoints[0]).passed).toBe(false);
  });
  it("accepts multiple open questions and reports direct text UX", () => {
    const f = fixture();
    f.checkpoints[0]!.interactions[0]!.payload.questionSet = { questions: [
      { id: "scope", prompt: "Clarify salary scope?", answerMode: "text" },
      { id: "audience", prompt: "Who is the audience?", answerMode: "text" },
    ] };
    expect(gradeBlocker(f).every(c => c.passed)).toBe(true);
    expect(gradeBlockerInputUx(f.checkpoints[0])).toMatchObject({ passed: true, questionCount: 2 });
  });
  it("does not accept confirmation resolution without a saved human scope change", () => {
    const f = fixture();
    f.checkpoints[0]!.interactions[0]!.kind = "request_confirmation";
    f.checkpoints[1]!.interactions[0]!.status = "rejected";
    f.checkpoints[1]!.interactions[0]!.result = { outcome: "rejected" };
    expect(gradeBlocker(f).find(c => c.id === "same-interaction-resolved")?.passed).toBe(false);
  });
  it("accepts human direction in a confirmation's saved rejection reason", () => {
    const f = fixture();
    f.checkpoints[0]!.interactions[0]!.kind = "request_confirmation";
    f.checkpoints[1]!.interactions[0]!.status = "rejected";
    f.checkpoints[1]!.interactions[0]!.result = { outcome: "rejected", reason: f.marker };
    expect(gradeBlocker(f).every(c => c.passed)).toBe(true);
  });
  it.each([
    ["comment-only wait", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.interactions = []; }],
    ["wrong requester", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.interactions[0]!.addresseeUserId = "someone-else"; }],
    ["missing requester", (f: ReturnType<typeof fixture>) => { delete f.checkpoints[0]!.interactions[0]!.addresseeUserId; }],
    ["anyone can resolve", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.interactions[0]!.effectiveResolverPolicy = "anyone"; }],
    ["agent resolved human input", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.interactions[0]!.resolvedByAgentId = "manager"; }],
    ["unsupported saved card", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.interactions[0]!.kind = "suggest_tasks"; }],
    ["missing wake", (f: ReturnType<typeof fixture>) => { delete f.checkpoints[0]!.interactions[0]!.continuationPolicy; }],
    ["agent escalation", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.interactions[0]!.addresseeAgentId = "manager"; }],
    ["handoff then restored ownership", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.activity.push({ action: "issue.updated", details: { assigneeAgentId: "manager" } }); }],
    ["nested ownership history", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.activity.push({ action: "issue.updated", details: { changes: { assigneeAgentId: { from: "worker", to: "manager" } } } }); }],
    ["extra task", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.issues.push({ id: "handoff" }); }],
    ["manager run", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.runs.push({ id: "manager-run", agentId: "manager", status: "succeeded", runtimeMode: "legacy" }); }],
    ["unpermitted hire", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.agents.push({ id: "casey" }); }],
    ["premature done", (f: ReturnType<typeof fixture>) => { f.checkpoints[0]!.issue.status = "done"; }],
    ["invented acknowledgement", (f: ReturnType<typeof fixture>) => { f.checkpoints[1]!.comments[0]!.authorAgentId = "requester"; }],
    ["missing continuation", (f: ReturnType<typeof fixture>) => { f.checkpoints.pop(); }],
    ["missing evidence", (f: ReturnType<typeof fixture>) => { f.checkpoints = []; }],
  ])("rejects %s", (_label, mutate) => { const f = fixture(); mutate(f); expect(gradeBlocker(f).some(c => !c.passed)).toBe(true); });
  it("registers six explicit local legacy cells and excludes them from --all", () => {
    const cells = selectRunnerExecutions(parseRunnerSelectors(["--suite", "blocker-guidance"]), runnerMatrix);
    expect(cells).toHaveLength(6);
    expect(cells.every(c => c.environment.id === "local" && c.profile.generation === "legacy")).toBe(true);
    expect(selectRunnerExecutions(parseRunnerSelectors(["--all"]), runnerMatrix).some(c => c.suite.id === "blocker-guidance")).toBe(false);
  });
});
