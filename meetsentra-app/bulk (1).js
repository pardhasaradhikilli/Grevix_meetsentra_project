// Helpers for inviting many people at once (pasted lists, CSV or text files).
const DROP = new Set(['username', 'usernames', 'name', 'names', 'user']); // header words in a CSV

export function parseNames(text) {
  return [...new Set(
    String(text).toLowerCase().split(/[\s,;]+/)
      .map((s) => s.replace(/["']/g, '').replace(/^@/, '').trim())
      .filter((s) => s && !DROP.has(s)),
  )];
}
export const isValidUsername = (n) => /^[a-z0-9_]{3,20}$/.test(n);
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- batches with retry ----
export const BATCH = 100;

// Try fn up to `tries` times with growing waits (400 ms, 800 ms, ...). `sleep` can be replaced in tests.
export async function withRetry(fn, { tries = 3, baseMs = 400, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) { last = e; if (i < tries - 1) await sleep(baseMs * 2 ** i); }
  }
  throw last;
}

// Run fn over batches of 100. Each batch is retried; a batch that still fails is recorded and the rest carry on.
// fn(part) may return an array of results. Returns { results, failedItems, firstError }.
export async function runBatches(items, fn, { size = BATCH, ...retryOpts } = {}) {
  const results = [], failedItems = []; let firstError = null;
  for (const part of chunk(items, size)) {
    try { const r = await withRetry(() => fn(part), retryOpts); if (Array.isArray(r)) results.push(...r); }
    catch (e) { failedItems.push(...part); firstError ??= e; }
  }
  return { results, failedItems, firstError };
}
