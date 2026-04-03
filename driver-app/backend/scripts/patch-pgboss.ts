/**
 * Patches pg-boss tools.js to fix Bun compatibility issue.
 *
 * Problem: pg-boss uses `setTimeout` from `node:timers/promises` with AbortSignal.
 * When the signal fires, Bun throws an uncaught AbortError that crashes the process.
 * Node.js contains this error within the promise chain, but Bun does not.
 *
 * Fix: Replace with plain globalThis.setTimeout + addEventListener('abort').
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const toolsPath = resolve(
  import.meta.dir,
  "../node_modules/pg-boss/dist/tools.js",
);

const patched = `/**
 * Patched for Bun compatibility — uses globalThis.setTimeout instead of node:timers/promises
 */
function unwrapSQLResult(result) {
    if (Array.isArray(result)) {
        return { rows: result.flatMap(i => i.rows) };
    }
    return result;
}
function delay(ms, error, abortController) {
    const ac = abortController || new AbortController();
    let timer;
    const promise = new Promise((resolve, reject) => {
        if (ac.signal.aborted) {
            resolve();
            return;
        }
        timer = globalThis.setTimeout(() => {
            if (error) {
                reject(new Error(error));
            }
            else {
                resolve();
            }
        }, ms);
        ac.signal.addEventListener('abort', () => {
            globalThis.clearTimeout(timer);
            resolve();
        }, { once: true });
    });
    promise.abort = () => {
        if (!ac.signal.aborted) {
            ac.abort();
        }
    };
    return promise;
}
async function resolveWithinSeconds(promise, seconds, message, abortController) {
    const timeout = Math.max(1, seconds) * 1000;
    const reject = delay(timeout, message, abortController);
    let result;
    try {
        result = await Promise.race([promise, reject]);
    }
    finally {
        reject.abort();
    }
    return result;
}
export { delay, resolveWithinSeconds, unwrapSQLResult };
`;

try {
  const current = readFileSync(toolsPath, "utf-8");
  if (current.includes("node:timers/promises")) {
    writeFileSync(toolsPath, patched);
    console.log("✓ Patched pg-boss tools.js for Bun compatibility");
  } else {
    console.log("✓ pg-boss tools.js already patched");
  }
} catch (e) {
  console.warn("⚠ Could not patch pg-boss:", e);
}
