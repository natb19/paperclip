import { buildAdapterEnvConfig, type CreateConfigValues } from "@paperclipai/adapter-utils";

function parseCommaArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Normalize an OpenCode UI numeric setting to a finite, non-negative value.
 * The fallback is normalized independently so malformed form data cannot leak.
 */
export function normalizeOpenCodeNumber(value: unknown, fallback: number): number {
  const normalizedFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? Math.max(0, fallback)
      : 0;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return normalizedFallback;
  }
  return Math.max(0, value);
}

export function buildOpenCodeLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model) ac.model = v.model;
  if (v.thinkingEffort) ac.variant = v.thinkingEffort;
  ac.dangerouslySkipPermissions = v.dangerouslySkipPermissions;
  // Default to no timeout and a short interrupt grace period; custom form values may override both.
  const schemaValues = v.adapterSchemaValues ?? {};
  const timeoutFallback = normalizeOpenCodeNumber(v.timeoutSec, 0);
  ac.timeoutSec = normalizeOpenCodeNumber(schemaValues.timeoutSec, timeoutFallback);
  ac.graceSec = normalizeOpenCodeNumber(schemaValues.graceSec, 20);
  const env = buildAdapterEnvConfig(v.envBindings, v.envVars);
  if (Object.keys(env).length > 0) ac.env = env;
  if (v.command) ac.command = v.command;
  if (v.extraArgs) ac.extraArgs = parseCommaArgs(v.extraArgs);
  return ac;
}
