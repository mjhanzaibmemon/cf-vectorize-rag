# cf-vectorize-rag

Multi-tenant retrieval on Cloudflare Workers AI and Vectorize, with citations, a
refusal path, and an eval harness that measures whether retrieval actually works.

It is small on purpose. The interesting parts are four decisions that most RAG
demos skip, and each one is visible in the code and checked by a test.

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

## Tests

    npm test

The logic that can be tested without the Workers runtime is kept separate from
the bindings, so the tests are plain unit tests: chunking and overlap, id
stability across re-ingest and across tenants, the refusal threshold, citation
formatting, and the auth rule that a tenant in the request body is ignored.

## Licence

See LICENSE. Readable so you can judge the work, not open source.
