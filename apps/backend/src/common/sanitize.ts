/**
 * Lightweight string sanitization for free-text DTO fields (reason, notes,
 * rejection_reason, etc).
 *
 * - trims surrounding whitespace
 * - strips ASCII control characters (0x00-0x1F, 0x7F) except tab/newline
 * - collapses internal whitespace runs to a single space
 *
 * Why: `class-validator` enforces length/type but not content quality.
 * We do not need rich HTML escaping (we never render these as HTML on the
 * server side; the frontend already escapes with React text nodes), but we
 * do need to keep low-byte garbage out of the audit log.
 */
export function sanitizeText(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input !== "string") return undefined;
  const trimmed = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s+/g, " ");
}
