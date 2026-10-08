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

/**
 * How many times to ask each question.
 *
 * Generation is sampled rather than deterministic, so one call per question
 * measures a coin flip and not the system. On 2026-10-08 a question scoring
 * 0.663 against a 0.65 threshold answered correctly on two calls and declined
 * on the next two, with identical retrieval every time. A single run would have
 * reported either of those as the result.
 *
 * The default stays 1 because every extra pass spends Workers AI quota. Raise it
 * when the number has to mean something:  REPEAT=5 npm run eval
 */
const REPEAT = Math.max(1, Number(process.env.REPEAT ?? 1));

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST, and respect the server when it says to slow down.
 *
 * The deployment rate limits the routes that call Workers AI, and at REPEAT=5
 * this harness asks forty questions in a burst, which is exactly the traffic
 * that limit exists to stop. A client that treats 429 as a failure is simply a
 * badly behaved client: the response carries retryAfter, so the correct
 * behaviour is to wait that long and continue.
 *
 * Waiting makes a large run slow rather than impossible, which is the right
 * trade for a measurement nobody is watching in real time.
 */
async function post(path: string, body: unknown): Promise<QueryResponse & Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < 10) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 5);
      const wait = (Number.isFinite(retryAfter) ? retryAfter : 5) + 1;
      console.log(`  rate limited, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) throw new Error(`${path} returned ${res.status}: ${await res.text()}`);
    return (await res.json()) as QueryResponse & Record<string, unknown>;
  }
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

  console.log(
    `
answerable questions (${REPEAT} call${REPEAT === 1 ? "" : "s"} each)`,
  );
  for (const item of golden.answerable) {
    let docHits = 0;
    let factHits = 0;
    let top = 0;

    for (let i = 0; i < REPEAT; i++) {
      const result = await post("/query", { question: item.question });
      if (result.citations.some((c) => c.docId === item.expectDoc)) docHits++;
      if (result.answer.toLowerCase().includes(item.expectText.toLowerCase())) factHits++;
      top = result.considered[0]?.score ?? 0;
    }

    // A question counts as grounded only when it holds on every call. Generation
    // is sampled, so a question that passes sometimes is not a pass with noise on
    // it; it is an unreliable answer, and averaging that away is how a flaky
    // system gets reported as a working one.
    if (docHits === REPEAT) retrieved++;
    if (factHits === REPEAT) grounded++;

    const flaky = factHits > 0 && factHits < REPEAT;
    console.log(
      `  ${docHits === REPEAT ? "OK " : "MISS"} ${
        factHits === REPEAT ? "fact" : flaky ? `${factHits}/${REPEAT} ` : "----"
      }  top=${top.toFixed(3)}  ${item.question}`,
    );
  }

  let refused = 0;

  console.log(
    `
questions the corpus cannot answer (${REPEAT} call${REPEAT === 1 ? "" : "s"} each)`,
  );
  for (const item of golden.unanswerable) {
    let refusals = 0;
    let top = 0;

    for (let i = 0; i < REPEAT; i++) {
      const result = await post("/query", { question: item.question });
      if (result.refused) refusals++;
      top = result.considered[0]?.score ?? 0;
    }

    // Refusing most of the time is not refusing. A question that invents an
    // answer on one call in five is a question that leaks, and the count has to
    // say so rather than round it away.
    if (refusals === REPEAT) refused++;

    const flaky = refusals > 0 && refusals < REPEAT;
    console.log(
      `  ${
        refusals === REPEAT ? "refused " : flaky ? `${refusals}/${REPEAT} ref` : "ANSWERED"
      }  top=${top.toFixed(3)}  ${item.question}`,
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
