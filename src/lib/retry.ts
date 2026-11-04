export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean;
}

/** Status codes worth retrying for HTTP-backed providers. */
export function isTransientError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const e = error as { status?: number; code?: number; retryable?: boolean; name?: string; message?: string };
    if (e.name === "AbortError") return false;
    if (e.retryable) return true;
    const status = e.status ?? e.code;
    if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
    if (typeof e.message === "string") return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(e.message);
  }
  return false;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/** Exponential backoff with full jitter. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 500, maxDelayMs = 8000, signal, shouldRetry = isTransientError } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(Math.random() * delay, signal);
    }
  }
  throw lastError;
}

/** Runs async tasks with bounded concurrency, preserving result order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
