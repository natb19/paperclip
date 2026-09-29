import { expect, test } from "@playwright/test";
import { answerBlockerThroughUi } from "./blocker-input.js";

test("answers every page of a saved question set", async ({ page }) => {
  await page.setContent(`<div data-testid="question-text-answer-composer"><textarea></textarea></div>
    <button>Next</button><script>
    window.answers = [];
    document.querySelector('button').onclick = () => {
      window.answers.push(document.querySelector('textarea').value);
      document.querySelector('textarea').value = '';
      document.querySelector('button').textContent = 'Submit answers';
    };</script>`);
  await answerBlockerThroughUi(page, { kind: "ask_user_questions", payload: {
    questionSet: { schema: "paperclip.question_set.v1", questions: [
      { id: "scope", answerMode: "text" }, { id: "audience", answerMode: "text" },
    ] },
  } }, "New direction");
  expect(await page.evaluate(() => (window as any).answers)).toEqual(["New direction", "New direction"]);
});

for (const kind of ["request_confirmation", "request_checkbox_confirmation"]) {
  for (const reason of [true, false]) {
    test(`declines ${kind} with saved scope change (reason=${reason})`, async ({ page }) => {
      await page.setContent(`<div id="card"><button id="decline">Cancel request</button>
        <button id="accept" onclick="window.accepted = true">Approve</button></div>
        <script>
        window.accepted = false;
        document.querySelector('#decline').onclick = () => {
          if (${reason} && !document.querySelector('#decision-reject-reason')) {
            const input = document.createElement('textarea'); input.id = 'decision-reject-reason';
            document.querySelector('#card').append(input); return;
          }
          window.reason = document.querySelector('textarea')?.value;
          document.querySelector('#card').innerHTML = '<div data-testid="task-chat-composer-input"><textarea></textarea></div><button data-testid="task-chat-composer-send">Send</button>';
          document.querySelector('button').onclick = () => { window.reply = document.querySelector('textarea').value; };
        };</script>`);
      await answerBlockerThroughUi(page, { id: "decision", kind, payload: {
        rejectLabel: "Cancel request", allowDeclineReason: reason,
      } }, "Change of scope");
      expect(await page.evaluate(() => ({ accepted: (window as any).accepted, reply: (window as any).reply })))
        .toEqual({ accepted: false, reply: reason ? undefined : "Change of scope" });
      if (reason) expect(await page.evaluate(() => (window as any).reason)).toBe("Change of scope");
    });
  }
}
