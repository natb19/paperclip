import { expect, type Page } from "@playwright/test";
import { chatQuestionPresentation } from "./chat-flow.js";
import { submitTaskReply } from "./user-actions.js";

/** The same scope change is supplied through whichever supported input the agent saved. */
export async function answerBlockerThroughUi(page: Page, interaction: Record<string, any>, answer: string) {
  if (interaction.kind === "ask_user_questions") {
    const presentation = chatQuestionPresentation(interaction.payload);
    expect(presentation.questions.length, "saved question set must contain a question").toBeGreaterThan(0);
    for (const [index, question] of presentation.questions.entries()) {
      const text = question.answerMode === "text";
      if (!text) {
        await page.getByRole(question.answerMode === "multi_select" ? "checkbox" : "radio", {
          name: question.customAnswer?.label ?? "Other", exact: true,
        }).last().click();
      }
      const editor = page.getByTestId(text ? "question-text-answer-composer" : "question-other-answer-composer")
        .last().locator('[contenteditable="true"],textarea').first();
      await expect(editor).toBeVisible();
      await editor.fill(answer);
      await page.getByRole("button", {
        name: index === presentation.questions.length - 1 ? presentation.submitLabel ?? "Submit answers" : "Next", exact: true,
      }).last().click();
    }
    return;
  }
  if (!["request_confirmation", "request_checkbox_confirmation"].includes(interaction.kind)) {
    throw new Error(`Unsupported blocker input: ${interaction.kind}`);
  }
  // The user changes scope; never approve a proposed admin/hiring action to pass an eval.
  const reject = page.getByRole("button", { name: interaction.payload.rejectLabel ?? "Reject", exact: true }).last();
  await reject.click();
  if (interaction.payload.rejectRequiresReason || interaction.payload.allowDeclineReason || interaction.payload.declineReasonPlaceholder) {
    await page.locator(`[id="${interaction.id}-reject-reason"]`).fill(answer);
    await reject.click();
  }
  await expect(reject).not.toBeVisible();
  // Declining alone does not wake the assignee. A normal user comment saves the
  // new scope and wakes it through the production path, within the four-run cap.
  await submitTaskReply(page, answer);
}
