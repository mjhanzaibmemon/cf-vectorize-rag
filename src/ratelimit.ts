/**
 * A fixed-window rate limiter over D1.
 *
 * This exists because the deployment is public and the two expensive routes
 * call Workers AI, which has a daily quota. Without a limit, one visitor
 * holding down a button exhausts the day for everyone else, and the next person
 * to open the link concludes the system is broken rather than rationed.
 *
 * Only the routes that cost money are counted. Serving the page and reading
 * /health are free, so rate limiting them would buy nothing and would make the
 * demo feel broken for the wrong reason.
 *
 * It is a fixed window rather than a sliding one, which means a caller can send
 * up to twice the limit across a window boundary. That is a real weakness and
 * the right trade here: a sliding window needs per-request history, and the
 * thing being protected is a daily quota, not a latency SLO. A system under
 * actual attack needs Cloudflare's own rate limiting in front of the Worker,
 * not application code.
 *
 * The limiter fails open. If D1 is unavailable the request proceeds, because a
 * demo that refuses everything when its bookkeeping breaks is worse than one
 * that briefly over-serves. A system where exceeding the limit costs real money
 * rather than quota should fail closed instead, and that is a decision worth
 * making deliberately rather than inheriting.
 */

export interface LimitResult {
  allowed: boolean;
  /** Requests used in the current window, including this one. */
  used: number;
  limit: number;
  /** Seconds until the window resets. */
  resetIn: number;
}

export interface LimitRule {
  limit: number;
  windowSeconds: number;
}

/** Generation is the expensive call, so questions are rationed harder. */
export const QUERY_LIMIT: LimitRule = { limit: 20, windowSeconds: 60 };
export const INGEST_LIMIT: LimitRule = { limit: 10, windowSeconds: 60 };

/** An ingest larger than this is refused before it reaches the embedding model. */
export const MAX_INGEST_CHARS = 20_000;

/**
 * Identify the caller.
 *
 * CF-Connecting-IP is set by Cloudflare's edge and cannot be spoofed by the
 * client, unlike X-Forwarded-For, which anyone may send. Falling back to a
 * shared bucket when it is absent is deliberate: an unidentifiable caller
 * should be limited, not exempt.
 */
export function callerKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export async function checkLimit(
  db: D1Database | undefined,
  caller: string,
  route: string,
  rule: LimitRule,
): Promise<LimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % rule.windowSeconds);
  const resetIn = windowStart + rule.windowSeconds - now;

  if (!db) return { allowed: true, used: 0, limit: rule.limit, resetIn };

  const bucket = `${route}:${caller}:${windowStart}`;

  try {
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1
         RETURNING hits`,
      )
      .bind(bucket, windowStart + rule.windowSeconds)
      .first<{ hits: number }>();

    const used = row?.hits ?? 1;
    return { allowed: used <= rule.limit, used, limit: rule.limit, resetIn };
  } catch (err) {
    // Fail open, and say so in the logs rather than silently.
    console.error("rate limit check failed, allowing request", err);
    return { allowed: true, used: 0, limit: rule.limit, resetIn };
  }
}

/**
 * Drop expired rows occasionally rather than on every request.
 *
 * The table is write-heavy and nothing reads old windows, so cleaning up on a
 * small fraction of requests keeps it bounded without paying for a delete on
 * every call. Running it inside waitUntil keeps it off the response path.
 */
export function sweepExpired(db: D1Database | undefined, now = Date.now()): Promise<unknown> {
  if (!db) return Promise.resolve();
  return db
    .prepare("DELETE FROM rate_limits WHERE expires_at < ?")
    .bind(Math.floor(now / 1000))
    .run()
    .catch((err) => console.error("rate limit sweep failed", err));
}

export function shouldSweep(): boolean {
  return Math.random() < 0.02;
}
