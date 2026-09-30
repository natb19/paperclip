const AGENT_URL_KEY_DELIM_RE = /[^a-z0-9]+/g;
const AGENT_URL_KEY_TRIM_RE = /^-+|-+$/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SHAPED_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return UUID_RE.test(value.trim());
}

/**
 * True for any textual UUID, including versions outside RFC 4122's 1-5 range
 * (nil, v6, v7) and non-RFC variant nibbles. Use this when deciding whether a
 * value is an id rather than a human-readable slug: those values are storable
 * primary keys, so mistaking one for a slug makes an existing row
 * unresolvable. `isUuidLike` stays the stricter RFC-4122 test for callers that
 * generate or trust UUID versions.
 */
export function isUuidShaped(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return UUID_SHAPED_RE.test(value.trim());
}

export function normalizeAgentUrlKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(AGENT_URL_KEY_DELIM_RE, "-")
    .replace(AGENT_URL_KEY_TRIM_RE, "");
  return normalized.length > 0 ? normalized : null;
}

export function deriveAgentUrlKey(name: string | null | undefined, fallback?: string | null): string {
  return normalizeAgentUrlKey(name) ?? normalizeAgentUrlKey(fallback) ?? "agent";
}
