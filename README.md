# cf-vectorize-rag

Multi-tenant retrieval on Cloudflare Workers AI and Vectorize, with citations, a
refusal path, and an eval harness that measures whether retrieval actually works.

It is small on purpose. The interesting parts are four decisions that most RAG
demos skip, and each one is visible in the code and checked by a test.

## Try it live

    https://cf-vectorize-rag.mjhanzaibmemon123.workers.dev

Two demo tenants, `acme` and `globex`, so the isolation claim is something you
can attack rather than take on trust.

```sh
URL=https://cf-vectorize-rag.mjhanzaibmemon123.workers.dev
ACME=demo_acme_7f3a91
GLOBEX=demo_globex_2c8e45

# Give each tenant a document.
curl -sX POST $URL/ingest -H "authorization: Bearer $ACME" -H 'content-type: application/json' \
  -d '{"docId":"handbook","text":"Staff receive 25 days of paid holiday each year."}'

curl -sX POST $URL/ingest -H "authorization: Bearer $GLOBEX" -H 'content-type: application/json' \
  -d '{"docId":"secrets","text":"The Globex launch codes are in the Frankfurt vault."}'

# Answers from its own document, and cites it.
curl -sX POST $URL/query -H "authorization: Bearer $ACME" -H 'content-type: application/json' \
  -d '{"question":"How many days of paid holiday do staff get?"}'

# Now ask acme for globex's secret, in globex's own words.
curl -sX POST $URL/query -H "authorization: Bearer $ACME" -H 'content-type: application/json' \
  -d '{"question":"Where are the Globex launch codes stored in the Frankfurt vault?"}'
```

The last call refuses, and the `considered` array is the part worth reading:
globex's chunk is not in it. It was never scored, because the tenant predicate
runs inside the query rather than filtering the results afterwards.

Re-run either `/ingest` call and the returned ids are identical. Nothing is
duplicated, because chunk ids are a hash of tenant, document, position and
content.

`/health` needs no token. Everything else returns 401 without one.

**On the demo's limits, since they matter:** this deployment uses D1 as a
brute-force index rather than Vectorize, because Vectorize requires the Workers
Paid plan. The application prefers Vectorize whenever the binding is present and
picks it up without a code change; see `getIndex` in
[src/d1-index.ts](src/d1-index.ts), which also says where brute force stops
being the right answer. Workers AI on the free plan has a daily limit, so if the
demo starts refusing everything, that is the quota rather than the retrieval.
The tokens above are demo tokens for a corpus of synthetic text.

## The four decisions

**It refuses.** If nothing retrieves above a score threshold, the app says it
doesn't know instead of letting the model write a confident paragraph from weak
context. Refusal is a reachable state with its own tests, because a system that
always answers has quietly started making things up and nobody can tell.

**Every answer is traceable.** Responses carry the chunk ids, document ids and
scores behind them, plus the scores of what was retrieved and *not* used. An
answer nobody can trace back to a source is just a sentence.

**Tenancy is resolved on the server.** The bearer token maps to a tenant, and
the Vectorize query filter is built from that value. A tenant id in the request
body is ignored, and a test asserts it. Every multi-tenant leak starts with
trusting the client to say who it is.

**Ingestion is idempotent.** Chunk ids are a hash of tenant, document, position
and content, so re-ingesting an unchanged document overwrites the same vectors
rather than creating near-duplicates that compete with each other at query
time. Edit one paragraph and only that chunk changes id. The eval proves this by
ingesting twice and comparing the ids.

## Endpoints

    GET  /health              models, dimensions, topK and the score threshold
    POST /ingest              { docId, text }      -> { chunks, ids }
    POST /query               { question }         -> { answer, refused, citations, considered }

Both POST routes need `Authorization: Bearer <token>`.

## Running it

    npm install
    wrangler vectorize create cf-vectorize-rag --dimensions=768 --metric=cosine
    wrangler vectorize create-metadata-index cf-vectorize-rag --property-name=tenant --type=string
    wrangler vectorize create-metadata-index cf-vectorize-rag --property-name=docId --type=string
    wrangler secret put TENANT_TOKENS      # {"tok_acme":"acme","tok_globex":"globex"}
    npm run deploy

The index dimensions must match the embedding model. They are both declared in
`src/config.ts`, so changing the model is one edit and a new index rather than a
subtle retrieval failure that looks like a bad prompt.

## The eval

    BASE_URL=https://your-worker.workers.dev TOKEN=tok_acme npm run eval

It ingests `eval/corpus`, asks questions from `eval/golden.json` whose answers
are known, and then asks questions the corpus cannot answer. It reports three
numbers: how often the right document was cited, how often the answer contained
the expected fact, and how often an unanswerable question was refused.

That third number is the one worth watching. Lower `MIN_SCORE` in the config and
the first two numbers improve while the third collapses, which is exactly the
trade you are making and the reason to measure it rather than feel it.

## What is deliberately not here

Deletion by document. Vectorize deletes by vector id, and it is a vector index
rather than a database you can scan by metadata, so "forget document X" needs a
docId to chunk-ids map in KV or D1. That is a real design decision an app has to
make, and implementing it badly here would look like a feature while missing
chunks.

Also not here: streaming responses, a UI, reranking, and hybrid keyword search.
Each is a reasonable next step; none of them change the four decisions above.

## Verifying it without a Cloudflare account

    npm install
    npm test

That runs the whole pipeline end to end against in-memory stand-ins for Workers
AI and Vectorize: ingest, chunk, embed, store, filter, retrieve, refuse, answer.
No account, no paid plan, no network. You can watch the claims above hold rather
than trust a screenshot:

- a tenant asking for another tenant's content, in that tenant's own words, gets
  an answer from its own documents and the other tenant's chunks are never even
  scored, because the filter runs inside the query rather than after it;
- re-ingesting an unchanged document produces identical ids and no duplicates;
- a question the corpus cannot answer is refused, with the scores it considered
  still reported;
- a tenant id in the request body is ignored in favour of the one the token maps
  to.

The fake embedding is a hashed bag of words. It is not a language model and does
not pretend to be. What it reproduces is the only property the application logic
depends on: text that shares vocabulary scores higher than text that does not.
The real models are swapped in by configuration, not by changing this code.

## Tests

    npm test
    npm run typecheck

Unit tests cover chunking and overlap, id stability across re-ingest and across
tenants, the refusal threshold, citation formatting, and the auth rule. The
integration tests drive the real `fetch` handler, so the routes, auth and error
codes are exercised rather than described.

## Licence

See LICENSE. Readable so you can judge the work, not open source.
