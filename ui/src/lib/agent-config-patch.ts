import {
  ADAPTER_AGNOSTIC_KEYS,
  aiConnectionBindingSchema,
  isAiConnectionCompatible,
  type Agent,
} from "@paperclipai/shared";

export interface AgentConfigOverlay {
  identity: Record<string, unknown>;
  adapterType?: string;
  adapterConfig: Record<string, unknown>;
  heartbeat: Record<string, unknown>;
  debug: Record<string, unknown>;
  runtime: Record<string, unknown>;
}

export function omitUndefinedEntries(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export function buildAgentUpdatePatch(agent: Agent, overlay: AgentConfigOverlay) {
  const patch: Record<string, unknown> = {};

  if (Object.keys(overlay.identity).length > 0) {
    Object.assign(patch, overlay.identity);
  }

  if (overlay.adapterType !== undefined) {
    patch.adapterType = overlay.adapterType;
  }

  if (overlay.adapterType !== undefined || Object.keys(overlay.adapterConfig).length > 0) {
    const existing = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    const nextAdapterConfig =
      overlay.adapterType !== undefined
        ? {
            ...Object.fromEntries(
              ADAPTER_AGNOSTIC_KEYS
                .filter((key) => existing[key] !== undefined)
                .map((key) => [key, existing[key]]),
            ),
            ...overlay.adapterConfig,
          }
        : {
            ...existing,
            ...overlay.adapterConfig,
          };

    patch.adapterConfig = omitUndefinedEntries(nextAdapterConfig);
    patch.replaceAdapterConfig = true;
  }

  const nextAdapterType = overlay.adapterType ?? agent.adapterType;
  const nextAdapterConfig = (patch.adapterConfig ?? agent.adapterConfig ?? {}) as Record<string, unknown>;
  const currentAdapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  // Only execution-routing changes can make an existing binding incompatible;
  // unrelated adapter settings must not silently remove authentication.
  const adapterExecutionTargetChanged =
    nextAdapterType !== agent.adapterType
    || nextAdapterConfig.model !== currentAdapterConfig.model
    || (
      nextAdapterType === "paperclip_runner"
      && (
        nextAdapterConfig.provider !== currentAdapterConfig.provider
        || nextAdapterConfig.acpxAgent !== currentAdapterConfig.acpxAgent
      )
    );
  const runtimeConfigOverlay = overlay.runtime.runtimeConfig;
  const hasExplicitAiConnectionReplacement =
    typeof runtimeConfigOverlay === "object"
    && runtimeConfigOverlay !== null
    && !Array.isArray(runtimeConfigOverlay)
    && Object.prototype.hasOwnProperty.call(runtimeConfigOverlay, "aiConnection");
  const existingAiConnection = aiConnectionBindingSchema.safeParse(agent.runtimeConfig?.aiConnection).data;
  const shouldClearAiConnection =
    adapterExecutionTargetChanged
    && existingAiConnection !== undefined
    && !hasExplicitAiConnectionReplacement
    && !isAiConnectionCompatible(
      existingAiConnection,
      nextAdapterType,
      nextAdapterConfig.model,
      nextAdapterConfig.provider,
      nextAdapterConfig.acpxAgent,
    );

  if (
    Object.keys(overlay.heartbeat).length > 0
    || Object.keys(overlay.debug).length > 0
  ) {
    const existingRc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const nextRuntimeConfig: Record<string, unknown> = (patch.runtimeConfig as Record<string, unknown> | undefined)
      ?? { ...existingRc };

    if (Object.keys(overlay.heartbeat).length > 0) {
      const existingHb = (existingRc.heartbeat ?? {}) as Record<string, unknown>;
      nextRuntimeConfig.heartbeat = { ...existingHb, ...overlay.heartbeat };
    }

    if (Object.keys(overlay.debug).length > 0) {
      const existingDebug = (existingRc.debug ?? {}) as Record<string, unknown>;
      const nextDebug = omitUndefinedEntries({ ...existingDebug, ...overlay.debug });
      if (Object.keys(nextDebug).length === 0) {
        delete nextRuntimeConfig.debug;
      } else {
        nextRuntimeConfig.debug = nextDebug;
      }
    }

    patch.runtimeConfig = nextRuntimeConfig;
  }

  if (Object.keys(overlay.runtime).length > 0) {
    Object.assign(patch, overlay.runtime);
  }

  if (shouldClearAiConnection) {
    // This is an update intent, not a replacement runtimeConfig value. The
    // server removes only aiConnection and keeps all other runtime settings.
    patch.clearAiConnection = true;
  }

  return patch;
}
