/**
 * Retrieval eval against a deployed worker.
 *
 * A RAG demo that answers one question in a screenshot proves nothing. This
 * ingests a known corpus, asks questions whose answers are known, and also asks
 * questions the corpus cannot answer, then scores both.
 *
 * The second half is the half people skip. A system tuned until it always
 * answers will score beautifully on answerable questions and invent an answer
 * for every other one.
 *
 *   BASE_URL=https://your-worker.workers.dev TOKEN=tok_acme npm run eval
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.dirname needs a recent Node and the right module settings, so
// derive it from the URL instead and work everywhere.
const here = fileURLToPath(new URL(".", import.meta.url));

const BASE_URL = process.env.BASE_URL;
const TOKEN = process.env.TOKEN;

if (!BASE_URL || !TOKEN) {
  console.error("set BASE_URL and TOKEN");
  process.exit(2);
}

interface Golden {
  answerable: { question: string; expectDoc: string; expectText: string }[];
  unanswerable: { question: string }[];
}

interface QueryResponse {
  answer: string;
  refused: boolean;
  citations: { id: string; docId: string; score: number }[];
  considered: { id: string; score: number }[];
}

async function post(path: string, body: unknown): Promise<QueryResponse & Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as QueryResponse & Record<string, unknown>;
}

async function main() {
  const corpusDir = join(here, "corpus");
  const golden = JSON.parse(readFileSync(join(here, "golden.json"), "utf8")) as Golden;

  console.log("ingesting corpus");
  for (const file of readdirSync(corpusDir).filter((f: string) => f.endsWith(".md"))) {
    const docId = file.replace(/\.md$/, "");
    const text = readFileSync(join(corpusDir, file), "utf8");

    const first = await post("/ingest", { docId, text });
    const second = await post("/ingest", { docId, text });

    const idempotent =
      JSON.stringify((first as unknown as { ids: string[] }).ids) ===
      JSON.stringify((second as unknown as { ids: string[] }).ids);

    console.log(
      `  ${docId}: ${first.chunks} chunks, re-ingest produced ${idempotent ? "the same ids" : "DIFFERENT IDS"}`,
    );
    if (!idempotent) process.exitCode = 1;
  }

  let retrieved = 0;
  let grounded = 0;

  console.log("\nanswerable questions");
  for (const item of golden.answerable) {
    const result = await post("/query", { question: item.question });

    const fromRightDoc = result.citations.some((c) => c.docId === item.expectDoc);
    const containsFact = result.answer.toLowerCase().includes(item.expectText.toLowerCase());

    if (fromRightDoc) retrieved++;
    if (containsFact) grounded++;

    const top = result.considered[0]?.score ?? 0;
    console.log(
      `  ${fromRightDoc ? "OK " : "MISS"} ${containsFact ? "fact" : "----"}  top=${top.toFixed(3)}  ${item.question}`,
    );
  }

  let refused = 0;

  console.log("\nquestions the corpus cannot answer");
  for (const item of golden.unanswerable) {
    const result = await post("/query", { question: item.question });
    if (result.refused) refused++;

    const top = result.considered[0]?.score ?? 0;
    console.log(
      `  ${result.refused ? "refused " : "ANSWERED"}  top=${top.toFixed(3)}  ${item.question}`,
    );
  }

  const a = golden.answerable.length;
  const u = golden.unanswerable.length;

  console.log(
    [
      "",
      `retrieval:  ${retrieved}/${a} cited the expected document`,
      `grounding:  ${grounded}/${a} answers contained the expected fact`,
      `refusal:    ${refused}/${u} unanswerable questions were refused`,
      "",
    ].join("\n"),
  );

  if (retrieved < a || refused < u) {
    console.error("eval failed: see the lines above");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
