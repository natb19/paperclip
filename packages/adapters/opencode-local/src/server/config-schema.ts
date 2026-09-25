import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import { DEFAULT_OPENCODE_LOCAL_MODEL } from "../index.js";

const VARIANT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
  { value: "max", label: "Max" },
];

/**
 * Declarative metadata for the OpenCode adapter configuration surface.
 *
 * Environment bindings remain owned by Paperclip's environment editor because
 * they are structured secret-aware values rather than scalar form fields. The
 * timeout and grace-period fields below are rendered by OpenCode's custom form
 * component, so declaring them does not hide the shared controls. Legacy
 * prompt-template settings are intentionally not declared as normal form fields.
 */
export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "model",
        label: "Model",
        type: "combobox",
        required: true,
        default: DEFAULT_OPENCODE_LOCAL_MODEL,
        hint: "OpenCode model ID in provider/model format, for example anthropic/claude-sonnet-5.",
      },
      {
        key: "variant",
        label: "Reasoning variant",
        type: "select",
        default: "",
        options: VARIANT_OPTIONS,
        hint: "Optional provider-specific OpenCode reasoning or profile variant.",
      },
      {
        key: "dangerouslySkipPermissions",
        label: "Skip permissions",
        type: "toggle",
        default: true,
        hint: "Inject a temporary runtime config that allows tools and connections for unattended runs.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Optional working directory for the OpenCode process. Paperclip creates it when possible.",
      },
      {
        key: "instructionsFilePath",
        label: "Agent instructions file",
        type: "text",
        hint: "Absolute path to a markdown instructions file prepended to each run prompt.",
      },
      {
        key: "command",
        label: "Command",
        type: "text",
        default: "opencode",
        hint: "OpenCode executable name or path. Defaults to opencode.",
      },
      {
        key: "extraArgs",
        label: "Extra args",
        type: "text",
        hint: "Optional comma-separated arguments appended to the OpenCode run command.",
      },
      {
        key: "timeoutSec",
        label: "Timeout (sec)",
        type: "number",
        default: 0,
        hint: "Maximum seconds a run can take before termination. 0 means no timeout.",
      },
      {
        key: "graceSec",
        label: "Interrupt grace period (sec)",
        type: "number",
        default: 20,
        hint: "Seconds to wait after an interrupt before force-killing the process.",
      },
    ],
  };
}
