/**
 * `next/headers` stub for the BDQ harness.
 *
 * lib/market-scope.ts reads the scope cookie when a request has one. The
 * harness never has a request: it passes an explicit scope key for each of the
 * locked BDQ scopes, so cookie access must resolve to "nothing stored" rather
 * than reaching into a Next request context that does not exist.
 */
export async function cookies() {
  return {
    get(_name: string): { name: string; value: string } | undefined { return undefined; },
    getAll() { return [] as { name: string; value: string }[]; },
    has(_name: string) { return false; },
  };
}
