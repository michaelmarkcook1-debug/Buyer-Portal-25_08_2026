/**
 * Module resolution for the BDQ harness, mirroring vitest.config.ts.
 *
 * The canonical resolver imports through the "@/" alias and pulls in
 * "server-only", neither of which bare Node understands. Vitest already
 * declares exactly these two mappings for the unit suite; this hook gives the
 * standalone harness the same resolution so both grade identical code.
 *
 * Extensionless specifiers are also resolved (".ts", ".tsx", "/index.ts"),
 * because the application source is written for a bundler.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..", "..");
const STUB = pathToFileURL(resolvePath(ROOT, "tests", "server-only-stub.ts")).href;
const HEADERS_STUB = pathToFileURL(resolvePath(ROOT, "scripts", "bdq", "next-headers-stub.ts")).href;
const CACHE_STUB = pathToFileURL(resolvePath(ROOT, "scripts", "bdq", "next-cache-stub.ts")).href;

const CANDIDATES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

function firstExisting(base) {
  for (const ext of CANDIDATES) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith("/")) {
      try {
        // a directory with no index should not resolve to itself
        if (ext === "" && !/\.[a-z]+$/.test(p)) continue;
      } catch { /* fall through */ }
      return pathToFileURL(p).href;
    }
  }
  return null;
}

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { pathToFileURL, fileURLToPath } from "node:url";
      import { dirname, resolve as resolvePath } from "node:path";
      const ROOT = ${JSON.stringify(ROOT)};
      const STUB = ${JSON.stringify(STUB)};
      const HEADERS_STUB = ${JSON.stringify(HEADERS_STUB)};
      const CACHE_STUB = ${JSON.stringify(CACHE_STUB)};
      const CANDIDATES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];
      function firstExisting(base) {
        for (const ext of CANDIDATES) {
          const p = base + ext;
          if (ext === "" && !/\\.[a-z]+$/.test(p)) continue;
          if (existsSync(p)) return pathToFileURL(p).href;
        }
        return null;
      }
      export async function resolve(specifier, context, next) {
        if (specifier === "server-only") return { url: STUB, shortCircuit: true };
        if (specifier === "next/headers") return { url: HEADERS_STUB, shortCircuit: true };
        if (specifier === "next/cache") return { url: CACHE_STUB, shortCircuit: true };
        if (specifier.startsWith("@/")) {
          const hit = firstExisting(resolvePath(ROOT, specifier.slice(2)));
          if (hit) return { url: hit, shortCircuit: true };
        }
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
          const hit = firstExisting(resolvePath(dirname(parentPath), specifier));
          if (hit) return { url: hit, shortCircuit: true };
        }
        return next(specifier, context);
      }
    `),
  import.meta.url,
);

// Silence the "type stripping is experimental" notice so the harness report
// stays the only thing on stdout.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (!/ExperimentalWarning/.test(String(w.name))) console.warn(w);
});

export { firstExisting };
