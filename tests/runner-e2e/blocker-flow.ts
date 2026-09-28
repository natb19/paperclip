import { expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pollUntil, type RunnerApi } from "./api.js";
import { blockerScenario } from "./blocker-cases.js";
import { setupBlockerFixtures } from "./blocker-fixtures.js";
import { gradeBlocker, type BlockerCheckpoint } from "./blocker-scoring.js";
import { chatQuestionPresentation } from "./chat-flow.js";
import type { LiveFixtureValues } from "./live-fixtures.js";
import type { MatrixExecution } from "./types.js";
import { createTaskThroughUi } from "./user-actions.js";
type Row = Record<string, any>;

export async function runBlockerFlow(input: {
  page: Page; api: RunnerApi; fixtures: LiveFixtureValues; execution: MatrixExecution;
  nonce: string; workspacePath: string; deadlineAt: number;
  observe(issue: any, runs: any[], checks: ReturnType<typeof gradeBlocker>): void;
  capture(id: string, label: string, file: string): Promise<void>;
  evidence(name: string, value: unknown): Promise<void>;
}) {
  const { page, api, fixtures, execution } = input;
  const scenario = blockerScenario(execution.task.id, input.nonce);
  const checkpoints: BlockerCheckpoint[] = [];
  let issue: Row | undefined;
  let runs: Row[] = [];
  let managerId = "";
  let checks: ReturnType<typeof gradeBlocker> = [];
  const company = `/api/companies/${fixtures.company.id}`;
  const hashes: Record<string, string> = {};
  const grade = (requireFinal: boolean) => gradeBlocker({ caseId: scenario.id, assigneeId: fixtures.agent.id,
    managerId, marker: scenario.marker, checkpoints, requireFinal });
  async function state(phase: BlockerCheckpoint["phase"]): Promise<BlockerCheckpoint> {
    issue = await api.get<Row>(`/api/issues/${issue!.id}`);
    const listed = await api.get<Row[]>(`${company}/heartbeat-runs?limit=100`);
    runs = await Promise.all(listed.map(r => api.get<Row>(`/api/heartbeat-runs/${r.id}`)));
    const [issues, agents, interactions, comments, activity, approvals] = await Promise.all([
      api.get<Row[]>(`${company}/issues`), api.get<Row[]>(`${company}/agents`),
      api.get<Row[]>(`/api/issues/${issue.id}/interactions`), api.get<Row[]>(`/api/issues/${issue.id}/comments?order=asc`),
      api.get<Row[]>(`/api/issues/${issue.id}/activity`), api.get<Row[]>(`${company}/approvals`),
    ]);
    input.observe(issue, runs, checks);
    return { phase, issue, issues, runs, agents, interactions, comments, activity, approvals };
  }
  async function settle(phase: BlockerCheckpoint["phase"]) {
    let lastKey = "";
    return pollUntil({ label: `blocker ${phase}`, deadlineAt: input.deadlineAt, intervalMs: 1000,
      load: () => state(phase), accept: s => {
        const idle = s.runs.length > 0 && s.runs.every(r => ["succeeded", "failed", "timed_out", "cancelled"].includes(r.status)) &&
          !s.issue.scheduledRetry && !s.issue.activeRecoveryAction;
        const ready = idle && (phase === "waiting" || s.issue.status === "done");
        const key = ready ? JSON.stringify([s.issue.status, s.runs.map(r => [r.id, r.status]), s.interactions.map(i => [i.id, i.status])]) : "";
        const stable = !!key && key === lastKey;
        lastKey = key;
        return stable;
      }, reject: s => s.runs.length > 4 ? "bounded run count exceeded" :
        s.runs.some(r => ["failed", "timed_out", "cancelled"].includes(r.status)) ? "provider run failed; see retained run records" : undefined });
  }
  async function open() {
    await page.goto(`/${fixtures.company.issuePrefix}/issues/${issue!.identifier ?? issue!.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: String(issue!.title), exact: true })).toBeVisible();
    await expect(page.getByTestId("issue-chat-skeleton")).toHaveCount(0);
  }
  function assertChecks() {
    const failed = checks.filter(c => !c.passed);
    input.observe(issue, runs, checks);
    if (failed.length) throw new Error(`Blocker outcome checks failed: ${failed.map(c => c.id).join(", ")}`);
  }
  try {
    for (const file of ["skills/paperclip/SKILL.md", "skills/paperclip/references/api-reference.md",
      ...["blocker-cases.ts", "blocker-flow.ts", "blocker-fixtures.ts", "blocker-scoring.ts"].map(f => `tests/runner-e2e/${f}`)]) {
      hashes[file] = createHash("sha256").update(await readFile(path.resolve(import.meta.dirname, "../..", file))).digest("hex");
    }
    const setup = await setupBlockerFixtures(input);
    managerId = setup.manager.id;
    await api.patch("/api/instance/settings/experimental", { enableClassicTaskInterface: false });
    await createTaskThroughUi({ page, issuePrefix: fixtures.company.issuePrefix!, agentName: fixtures.agent.name,
      title: execution.task.buildTitle(input.nonce), prompt: scenario.prompt, workMode: "standard" });
    issue = await pollUntil({ label: "browser-created blocker task", deadlineAt: input.deadlineAt,
      load: async () => (await api.get<Row[]>(`${company}/issues`)).find(i => i.title === execution.task.buildTitle(input.nonce)), accept: Boolean });
    if (!issue) throw new Error("No browser-created task");
    checkpoints.push(await settle("waiting"));
    await open();
    await input.capture("blocker-waiting", "Saved blocker decision", "decision-pending.png");
    checks = grade(false);
    assertChecks();
    // Reload proves the waiting interaction is durable before a real UI answer.
    await page.reload();
    const question = checkpoints[0]!.interactions.find(i => i.kind === "ask_user_questions" && i.status === "pending")!;
    const presentation = chatQuestionPresentation(question.payload);
    expect(presentation.questions).toHaveLength(1);
    const editor = page.getByTestId(presentation.questions[0]?.answerMode === "text" ? "question-text-answer-composer" : "question-other-answer-composer").last().locator('[contenteditable="true"],textarea').first();
    if (presentation.questions[0]?.answerMode !== "text") {
      await page.getByRole("radio", { name: presentation.questions[0]?.customAnswer?.label ?? "Other", exact: true }).last().click();
    }
    await expect(editor).toBeVisible();
    await editor.fill(scenario.answer);
    await page.getByRole("button", { name: presentation.submitLabel ?? "Submit answers", exact: true }).last().click();
    await pollUntil({ label: "saved browser decision", deadlineAt: input.deadlineAt,
      load: () => api.get<Row[]>(`/api/issues/${issue!.id}/interactions`),
      accept: rows => rows.some(i => i.id === question.id && i.status === "answered") });
    checkpoints.push(await settle("final"));
    checks = grade(true);
    await open();
    const reply = checkpoints.at(-1)!.comments.find(c => c.authorAgentId === fixtures.agent.id && String(c.body).includes(scenario.marker));
    expect(reply, "the worker's acknowledgement must be persisted").toBeTruthy();
    const bubble = page.getByTestId("task-chat-agent-bubble").filter({ hasText: scenario.marker });
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toBeVisible();
    await bubble.scrollIntoViewIfNeeded();
    await input.capture("final-state", "Original worker completed after human answer", "final-state.png");
    assertChecks();
    return { issue: issue!, runs, checks };
  } catch (error) {
    checks.push({ id: "workflow-completed", passed: false, detail: error instanceof Error ? error.message : String(error) });
    if (issue) input.observe(issue, runs, checks);
    throw error;
  } finally {
    let lastObservation: unknown;
    if (issue) lastObservation = await state("final").catch(error => ({ evidenceError: String(error) }));
    await input.evidence("api-state.json", { capturePhase: "blocker-final", issue, runs, checks, lastObservation });
    await input.evidence("blocker-guidance.json", { schema: "paperclip.blocker-guidance.v1", caseId: scenario.id,
      prompt: scenario.prompt, hashes, managerId, assigneeId: fixtures.agent.id, checks, checkpoints, lastObservation });
  }
}
