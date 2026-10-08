import { answerQuestion } from "./answer";
import { tenantFromRequest } from "./auth";
import { buildChunks } from "./chunk";
import { HOME_HTML } from "./home";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, GENERATION_MODEL, MIN_SCORE, TOP_K } from "./config";
import { retrieve, upsertChunks } from "./store";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        });
      }

      if (request.method === "POST" && url.pathname === "/ingest") {
        return await handleIngest(request, env);
      }

      if (request.method === "POST" && url.pathname === "/query") {
        return await handleQuery(request, env);
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

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const tenant = tenantFromRequest(request, env);
  if (!tenant) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as {
    docId?: string;
    text?: string;
  } | null;

  if (!body?.docId || !body?.text) {
    return json({ error: "docId and text are required" }, 400);
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

async function handleQuery(request: Request, env: Env): Promise<Response> {
  const tenant = tenantFromRequest(request, env);
  if (!tenant) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question) return json({ error: "question is required" }, 400);

  const matches = await retrieve(env, tenant, question);
  const result = await answerQuestion(env, question, matches);

  return json(result);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
