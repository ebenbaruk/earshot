/**
 * Pure helper shared by the browser controller and the headless dry-run.
 */
/** True for AAA (3 identical) or ABAB (4 alternating) command histories. */
export function isDithering(keys: string[]): boolean {
  const n = keys.length;
  if (n >= 3 && keys[n - 1] === keys[n - 2] && keys[n - 2] === keys[n - 3]) return true;
  if (n >= 4 && keys[n - 1] === keys[n - 3] && keys[n - 2] === keys[n - 4] && keys[n - 1] !== keys[n - 2]) return true;
  return false;
}
