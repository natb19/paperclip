import { describe, expect, it } from "vitest";
import {
  AGENT_ROLE_LABELS,
  acceptInviteSchema,
  agentRuntimeConfigSchema,
  createAgentHireSchema,
  createAgentSchema,
  updateAgentSchema,
} from "./index.js";

describe("dynamic adapter type validation schemas", () => {
  it("accepts external adapter types in create/update agent schemas", () => {
    expect(
      createAgentSchema.parse({
        name: "External Agent",
        adapterType: "external_adapter",
      }).adapterType,
    ).toBe("external_adapter");

    expect(
      updateAgentSchema.parse({
        adapterType: "external_adapter",
      }).adapterType,
    ).toBe("external_adapter");
  });

  it("still rejects blank adapter types", () => {
    expect(() =>
      createAgentSchema.parse({
        name: "Blank Adapter",
        adapterType: "   ",
      }),
    ).toThrow();
  });

  it("accepts an explicit managed instructions bundle for new agents", () => {
    expect(
      createAgentSchema.parse({
        name: "Bundle Agent",
        adapterType: "codex_local",
        instructionsBundle: {
          files: {
            "AGENTS.md": "Use AGENTS.md.",
          },
        },
      }).instructionsBundle?.files["AGENTS.md"],
    ).toBe("Use AGENTS.md.");
  });

  it("accepts external adapter types in invite acceptance schema", () => {
    expect(
      acceptInviteSchema.parse({
        requestType: "agent",
        agentName: "External Joiner",
        adapterType: "external_adapter",
      }).adapterType,
    ).toBe("external_adapter");
  });

  it("accepts the security agent role and exposes its UI label", () => {
    expect(
      createAgentSchema.parse({
        name: "Security Engineer",
        role: "security",
        adapterType: "codex_local",
      }).role,
    ).toBe("security");

    expect(AGENT_ROLE_LABELS.security).toBe("Security");
  });

  it("accepts clearAiConnection only as an update intent", () => {
    expect(updateAgentSchema.parse({ clearAiConnection: true }).clearAiConnection).toBe(true);
    expect(updateAgentSchema.parse({ clearAiConnection: false }).clearAiConnection).toBe(false);
    expect(() => updateAgentSchema.parse({ clearAiConnection: "true" })).toThrow();
    expect(
      createAgentSchema.parse({
        name: "New Agent",
        adapterType: "codex_local",
        clearAiConnection: true,
      }),
    ).not.toHaveProperty("clearAiConnection");
    expect(
      createAgentHireSchema.parse({
        name: "Hired Agent",
        adapterType: "codex_local",
        clearAiConnection: true,
      }),
    ).not.toHaveProperty("clearAiConnection");
    expect(agentRuntimeConfigSchema.shape).not.toHaveProperty("clearAiConnection");
    expect(() => agentRuntimeConfigSchema.parse({ aiConnection: null })).toThrow();
  });
});
