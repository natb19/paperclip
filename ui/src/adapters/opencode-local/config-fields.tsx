import { normalizeOpenCodeNumber } from "@paperclipai/adapter-opencode-local/ui";
import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  ToggleField,
  DraftInput,
  DraftNumberInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function OpenCodeLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  return configFieldsForSection(section, (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      <ToggleField
        label="Skip permissions"
        hint={help.dangerouslySkipPermissions}
        checked={
          isCreate
            ? values!.dangerouslySkipPermissions
            : eff(
                "adapterConfig",
                "dangerouslySkipPermissions",
                config.dangerouslySkipPermissions !== false,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ dangerouslySkipPermissions: v })
            : mark("adapterConfig", "dangerouslySkipPermissions", v)
        }
      />
      <Field configSection="runPolicy" label="Timeout (sec)" hint={help.timeoutSec}>
        <DraftNumberInput
          value={
            isCreate
              ? normalizeOpenCodeNumber(values!.adapterSchemaValues?.timeoutSec, 0)
              : normalizeOpenCodeNumber(
                  eff("adapterConfig", "timeoutSec", config.timeoutSec),
                  0,
                )
          }
          onCommit={(v) => {
            const normalizedValue = normalizeOpenCodeNumber(v, 0);
            if (isCreate) {
              set!({
                adapterSchemaValues: {
                  ...(values!.adapterSchemaValues ?? {}),
                  timeoutSec: normalizedValue,
                },
              });
            } else {
              mark("adapterConfig", "timeoutSec", normalizedValue);
            }
          }}
          immediate
          className={inputClass}
          min={0}
          step={1}
          aria-label="Timeout (sec)"
        />
      </Field>
      <Field configSection="runPolicy" label="Interrupt grace period (sec)" hint={help.graceSec}>
        <DraftNumberInput
          value={
            isCreate
              ? normalizeOpenCodeNumber(values!.adapterSchemaValues?.graceSec, 20)
              : normalizeOpenCodeNumber(
                  eff("adapterConfig", "graceSec", config.graceSec),
                  20,
                )
          }
          onCommit={(v) => {
            const normalizedValue = normalizeOpenCodeNumber(v, 20);
            if (isCreate) {
              set!({
                adapterSchemaValues: {
                  ...(values!.adapterSchemaValues ?? {}),
                  graceSec: normalizedValue,
                },
              });
            } else {
              mark("adapterConfig", "graceSec", normalizedValue);
            }
          }}
          immediate
          className={inputClass}
          min={0}
          step={1}
          aria-label="Interrupt grace period (sec)"
        />
      </Field>
    </>
  ));
}
