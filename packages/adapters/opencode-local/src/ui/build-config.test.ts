import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildOpenCodeLocalConfig } from "./build-config.js";
import { normalizeOpenCodeNumber } from "./index.js";

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

describe("normalizeOpenCodeNumber", () => {
  it("clamps finite negatives and normalizes malformed candidates and fallbacks", () => {
    expect(normalizeOpenCodeNumber(-1, 20)).toBe(0);
    expect(normalizeOpenCodeNumber("12", 20)).toBe(20);
    expect(normalizeOpenCodeNumber(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeOpenCodeNumber(4, -3)).toBe(4);
    expect(normalizeOpenCodeNumber("bad", -3)).toBe(0);
  });
});

describe("buildOpenCodeLocalConfig", () => {
  it("uses safe run-policy defaults", () => {
    expect(buildOpenCodeLocalConfig(makeValues())).toMatchObject({
      timeoutSec: 0,
      graceSec: 20,
    });
  });

  it("clamps a negative form timeout fallback", () => {
    expect(buildOpenCodeLocalConfig(makeValues({ timeoutSec: -30 }))).toMatchObject({
      timeoutSec: 0,
      graceSec: 20,
    });
  });

  it("clamps negative schema values while preserving valid mixed values", () => {
    expect(
      buildOpenCodeLocalConfig(
        makeValues({
          adapterSchemaValues: { timeoutSec: -45, graceSec: -9 },
        }),
      ),
    ).toMatchObject({
      timeoutSec: 0,
      graceSec: 0,
    });
    expect(
      buildOpenCodeLocalConfig(
        makeValues({
          timeoutSec: -30,
          adapterSchemaValues: { timeoutSec: 60, graceSec: 12 },
        }),
      ),
    ).toMatchObject({
      timeoutSec: 60,
      graceSec: 12,
    });
  });

  it("persists custom schema-backed run-policy values", () => {
    expect(
      buildOpenCodeLocalConfig(
        makeValues({
          adapterSchemaValues: { timeoutSec: 45, graceSec: 7 },
        }),
      ),
    ).toMatchObject({
      timeoutSec: 45,
      graceSec: 7,
    });
  });

  it("falls back to the form timeout when no schema timeout is present", () => {
    expect(buildOpenCodeLocalConfig(makeValues({ timeoutSec: 90 }))).toMatchObject({
      timeoutSec: 90,
      graceSec: 20,
    });
  });

  it("falls back safely for invalid and non-finite run-policy values", () => {
    expect(
      buildOpenCodeLocalConfig(
        makeValues({
          timeoutSec: 90,
          adapterSchemaValues: {
            timeoutSec: "45",
            graceSec: Number.POSITIVE_INFINITY,
          },
        }),
      ),
    ).toMatchObject({
      timeoutSec: 90,
      graceSec: 20,
    });
  });

  it("preserves the existing scalar adapter mappings", () => {
    const config = buildOpenCodeLocalConfig(
      makeValues({
        cwd: "/workspace/project",
        instructionsFilePath: "/workspace/AGENTS.md",
        model: "openrouter/anthropic/claude-sonnet-5",
        thinkingEffort: "high",
        command: "opencode",
        extraArgs: "--foo, --bar",
        envBindings: {
          LOG_LEVEL: { type: "plain", value: "info" },
        },
      }),
    );

    expect(config).toMatchObject({
      cwd: "/workspace/project",
      instructionsFilePath: "/workspace/AGENTS.md",
      model: "openrouter/anthropic/claude-sonnet-5",
      variant: "high",
      dangerouslySkipPermissions: true,
      command: "opencode",
      extraArgs: ["--foo", "--bar"],
      env: { LOG_LEVEL: { type: "plain", value: "info" } },
    });
  });
});
