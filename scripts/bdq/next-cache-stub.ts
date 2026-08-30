/**
 * `next/cache` stub for the BDQ harness.
 *
 * The generator wraps briefings in unstable_cache so the app serves a briefing
 * for six hours. A quality gate wants the opposite: every Mode B run should
 * grade a FRESHLY generated briefing, not whatever the app happened to cache.
 * So this passes the function straight through, uncached.
 */
export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  _keyParts?: readonly unknown[],
  _opts?: { revalidate?: number | false; tags?: string[] },
): T {
  return fn;
}
export function revalidateTag(_tag: string): void {}
export function revalidatePath(_path: string): void {}
