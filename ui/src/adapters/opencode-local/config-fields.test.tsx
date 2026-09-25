import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

import { OpenCodeLocalConfigFields } from "./config-fields";
import type { AdapterConfigFieldsProps } from "../types";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "opencode_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "openai/gpt-5.2-codex",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: true,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 1000,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

function renderFields(overrides: Partial<AdapterConfigFieldsProps> = {}): string {
  const props: AdapterConfigFieldsProps = {
    section: "runPolicy",
    mode: "create",
    isCreate: true,
    adapterType: "opencode_local",
    values: makeValues(),
    set: () => undefined,
    config: {},
    eff: (_group, _field, original) => original,
    mark: () => undefined,
    models: [],
    ...overrides,
  };

  return renderToStaticMarkup(
    <TooltipProvider>
      <OpenCodeLocalConfigFields {...props} />
    </TooltipProvider>,
  );
}

function inputWithLabel(markup: string, label: string): string {
  const marker = `aria-label="${label}"`;
  const markerIndex = markup.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<input", markerIndex);
  const end = markup.indexOf(">", markerIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(markerIndex);
  return markup.slice(start, end + 1);
}

describe("OpenCodeLocalConfigFields run policy", () => {
  it("renders accessible create defaults and bounded numeric controls", () => {
    const markup = renderFields();
    const timeout = inputWithLabel(markup, "Timeout (sec)");
    const grace = inputWithLabel(markup, "Interrupt grace period (sec)");

    expect(timeout).toContain('type="number"');
    expect(timeout).toContain('value="0"');
    expect(timeout).toContain('min="0"');
    expect(timeout).toContain('step="1"');
    expect(timeout).toContain("focus-visible:ring-ring");
    expect(grace).toContain('type="number"');
    expect(grace).toContain('value="20"');
    expect(grace).toContain('min="0"');
    expect(grace).toContain('step="1"');
    expect(grace).toContain("focus-visible:ring-ring");
  });

  it("clamps negative create and edit values before rendering", () => {
    const createMarkup = renderFields({
      values: makeValues({
        adapterSchemaValues: { timeoutSec: -5, graceSec: -9 },
      }),
    });
    const editMarkup = renderFields({
      mode: "edit",
      isCreate: false,
      values: null,
      set: null,
      config: { timeoutSec: -45, graceSec: -7 },
    });

    expect(inputWithLabel(createMarkup, "Timeout (sec)")).toContain('value="0"');
    expect(inputWithLabel(createMarkup, "Interrupt grace period (sec)")).toContain('value="0"');
    expect(inputWithLabel(editMarkup, "Timeout (sec)")).toContain('value="0"');
    expect(inputWithLabel(editMarkup, "Interrupt grace period (sec)")).toContain('value="0"');
  });

  it("renders existing edit values for both run-policy controls", () => {
    const markup = renderFields({
      mode: "edit",
      isCreate: false,
      values: null,
      set: null,
      config: { timeoutSec: 45, graceSec: 7 },
    });

    expect(inputWithLabel(markup, "Timeout (sec)")).toContain('value="45"');
    expect(inputWithLabel(markup, "Interrupt grace period (sec)")).toContain('value="7"');
  });
});
