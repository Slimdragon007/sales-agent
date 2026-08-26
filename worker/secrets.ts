/**
 * Presence check for Worker secrets.
 *
 * 1Password items that are not yet filled resolve via `op inject` to the
 * literal string FILL_ME. That value is truthy, so `Boolean(env.X)` and
 * `env.X?.trim()` would report the secret as configured while holding
 * nothing usable. Treat placeholders (and empty / whitespace) as absent.
 */
export function isConfiguredSecret(
  value: string | undefined | null,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "FILL_ME";
}
