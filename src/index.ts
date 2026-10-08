import { answerQuestion } from "./answer";
import { tenantFromRequest } from "./auth";
import { buildChunks } from "./chunk";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, GENERATION_MODEL, MIN_SCORE, TOP_K } from "./config";
import { HOME_HTML } from "./home";
import {
  callerKey,
  checkLimit,
  INGEST_LIMIT,
  MAX_INGEST_CHARS,
  QUERY_LIMIT,
  shouldSweep,
  sweepExpired,
  type LimitResult,
  type LimitRule,
} from "./ratelimit";
import { listDocuments, retrieve, upsertChunks } from "./store";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
        return new Response(HOME_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          embeddingModel: EMBEDDING_MODEL,
          generationModel: GENERATION_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
          topK: TOP_K,
          minScore: MIN_SCORE,
          limits: {
            query: `${QUERY_LIMIT.limit} per ${QUERY_LIMIT.windowSeconds}s`,
            ingest: `${INGEST_LIMIT.limit} per ${INGEST_LIMIT.windowSeconds}s`,
            maxIngestChars: MAX_INGEST_CHARS,
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/documents") {
        const tenant = tenantFromRequest(request, env);
        if (!tenant) return json({ error: "unauthorized" }, 401);
        return json({ tenant, documents: await listDocuments(env, tenant) });
      }

      if (request.method === "POST" && url.pathname === "/ingest") {
        return await limited(request, env, ctx, "ingest", INGEST_LIMIT, (tenant) =>
          handleIngest(request, env, tenant),
        );
      }

      if (request.method === "POST" && url.pathname === "/query") {
        return await limited(request, env, ctx, "query", QUERY_LIMIT, (tenant) =>
          handleQuery(request, env, tenant),
        );
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      // The message goes to the logs, not to the caller. An error string from a
      // model provider is exactly the kind of thing that leaks an internal id.
      console.error("request failed", err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Authenticate, then count the call, then do the work.
 *
 * The order matters. Authenticating first means an unauthenticated flood never
 * writes to the limiter's table, so the cheap rejection stays cheap. Counting
 * before the work means a caller cannot escape the limit by sending requests
 * that fail slowly.
 */
async function limited(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  route: string,
  rule: LimitRule,
  handler: (tenant: string) => Promise<Response>,
): Promise<Response> {
  const tenant = tenantFromRequest(request, env);
  if (!tenant) return json({ error: "unauthorized" }, 401);

  const limit = await checkLimit(env.DB, callerKey(request), route, rule);

  if (shouldSweep()) ctx.waitUntil(sweepExpired(env.DB));

  if (!limit.allowed) {
    return json(
      {
        error: "rate limited",
        detail:
          `This demo allows ${rule.limit} ${route} calls per ${rule.windowSeconds}s per IP, ` +
          "because Workers AI has a daily quota and one visitor should not spend everybody's.",
        retryAfter: limit.resetIn,
      },
      429,
      rateHeaders(limit),
    );
  }

  const response = await handler(tenant);
  for (const [k, v] of Object.entries(rateHeaders(limit))) response.headers.set(k, v);
  return response;
}

function rateHeaders(limit: LimitResult): Record<string, string> {
  return {
    "retry-after": String(limit.resetIn),
    "x-ratelimit-limit": String(limit.limit),
    "x-ratelimit-remaining": String(Math.max(0, limit.limit - limit.used)),
    "x-ratelimit-reset": String(limit.resetIn),
  };
}

async function handleIngest(request: Request, env: Env, tenant: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    docId?: string;
    text?: string;
  } | null;

  if (!body?.docId || !body?.text) {
    return json({ error: "docId and text are required" }, 400);
  }

  // Checked before chunking, so an oversized document is refused without
  // spending an embedding call on it.
  if (body.text.length > MAX_INGEST_CHARS) {
    return json(
      {
        error: "document too large",
        detail: `This demo accepts up to ${MAX_INGEST_CHARS} characters; received ${body.text.length}.`,
      },
      413,
    );
  }

  const chunks = await buildChunks(tenant, body.docId, body.text);
  if (chunks.length === 0) return json({ error: "text produced no chunks" }, 400);

  const count = await upsertChunks(env, tenant, chunks);

  // Ids are returned so a caller can see that re-ingesting unchanged text
  // produces the same ids, which is the whole point of hashing them.
  return json({
    docId: body.docId,
    chunks: count,
    ids: chunks.map((c) => c.id),
  });
}

async function handleQuery(request: Request, env: Env, tenant: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    question?: string;
    minScore?: number;
  } | null;

  const question = body?.question?.trim();
  if (!question) return json({ error: "question is required" }, 400);

  const matches = await retrieve(env, tenant, question);
  const result = await answerQuestion(env, question, matches, clampScore(body?.minScore));

  return json(result);
}

/**
 * A caller may tune the threshold; a caller may not send nonsense.
 *
 * An out-of-range or non-numeric value falls back to the configured default
 * rather than failing the request, because the parameter is a preference and a
 * bad preference should not cost someone their answer. A caller-supplied value
 * that governed access rather than relevance would deserve the opposite
 * treatment: reject, loudly.
 */
function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MIN_SCORE;
  return Math.min(1, Math.max(0, value));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
