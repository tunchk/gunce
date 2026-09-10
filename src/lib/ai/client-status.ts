/**
 * Client-safe hint only — never exposes secrets.
 * Real availability is passed from the server page via `features`.
 */
export function getAiFeatureStatusClientHint(): string {
  return "";
}
