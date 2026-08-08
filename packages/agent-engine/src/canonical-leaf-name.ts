/**
 * A validated, single path segment. This is intentionally platform-neutral and
 * stricter than any individual filesystem: callers must not turn an unchecked
 * string into a root-relative engineering identity.
 */
export type CanonicalLeafName = string & { readonly __canonicalLeafName: unique symbol };

export type CanonicalLeafNameRejectCode =
  | "invalid_type"
  | "empty"
  | "dot_segment"
  | "invalid_unicode"
  | "non_canonical_unicode"
  | "too_long"
  | "separator"
  | "ads_or_drive_prefix"
  | "platform_illegal_character"
  | "control_or_format_character"
  | "trailing_dot_or_space"
  | "windows_reserved_name";

export type CanonicalLeafNameValidation =
  | { readonly ok: true; readonly value: CanonicalLeafName }
  | { readonly ok: false; readonly code: CanonicalLeafNameRejectCode };

/** Windows and all supported native backends can enforce this conservative ceiling. */
export const CANONICAL_LEAF_NAME_MAX_CODE_POINTS = 255;
export const CANONICAL_LEAF_NAME_MAX_UTF8_BYTES = 255;

const WINDOWS_RESERVED_DEVICE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)|^(?:clock\$|conin\$|conout\$)(?:\.|$)/iu;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const PLATFORM_ILLEGAL_CHARACTER = /[<>"|?*]/u;

export function validateCanonicalLeafName(input: unknown): CanonicalLeafNameValidation {
  if (typeof input !== "string") return rejected("invalid_type");
  if (input.length === 0) return rejected("empty");
  if (!isWellFormedUnicode(input)) return rejected("invalid_unicode");
  if (input === "." || input === "..") return rejected("dot_segment");
  if (input.normalize("NFC") !== input) return rejected("non_canonical_unicode");
  if (
    countCodePoints(input) > CANONICAL_LEAF_NAME_MAX_CODE_POINTS ||
    utf8ByteLength(input) > CANONICAL_LEAF_NAME_MAX_UTF8_BYTES
  ) {
    return rejected("too_long");
  }
  if (input.includes("/") || input.includes("\\")) return rejected("separator");
  // ':' is disallowed rather than interpreted: this closes both ADS and drive-relative forms.
  if (input.includes(":")) return rejected("ads_or_drive_prefix");
  if (PLATFORM_ILLEGAL_CHARACTER.test(input)) return rejected("platform_illegal_character");
  if (CONTROL_OR_FORMAT_CHARACTER.test(input)) return rejected("control_or_format_character");
  if (input.endsWith(".") || input.endsWith(" ")) return rejected("trailing_dot_or_space");
  if (WINDOWS_RESERVED_DEVICE_NAME.test(input)) return rejected("windows_reserved_name");

  return { ok: true, value: input as CanonicalLeafName };
}

/**
 * A conservative collision key for a leaf within a case-insensitive directory.
 * NFC is guaranteed by the validated input; lower-casing is deliberately locale-neutral.
 */
export function canonicalLeafNameCollisionKey(name: CanonicalLeafName): string {
  return name.toLowerCase();
}

/** Returns the first duplicate collision key without reporting either name. */
export function findCanonicalLeafNameCollision(names: readonly CanonicalLeafName[]): {
  readonly collision: boolean;
} {
  const seen = new Set<string>();
  for (const name of names) {
    const key = canonicalLeafNameCollisionKey(name);
    if (seen.has(key)) return { collision: true };
    seen.add(key);
  }
  return { collision: false };
}

function rejected(code: CanonicalLeafNameRejectCode): CanonicalLeafNameValidation {
  return { ok: false, code };
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
