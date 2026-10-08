# cf-vectorize-rag

Multi-tenant retrieval on Cloudflare Workers AI and Vectorize, with citations, a
refusal path, and an eval harness that measures whether retrieval actually works.

It is small on purpose. The interesting parts are four decisions that most RAG
demos skip, and each one is visible in the code and checked by a test.

## Try it live

    https://cf-vectorize-rag.mjhanzaibmemon123.workers.dev

Open it and you get a page that lets you switch tenant, read the corpus, add
your own text, ask questions, and drag the score threshold to watch refusal turn
on and off. Every answer is drawn against the threshold line, so you can see
which chunks were used, which were considered and rejected, and how close the
call was.

Two demo tenants, `acme` and `globex`, so the isolation claim is something you
can attack rather than take on trust. The threshold slider is part of that: it
goes all the way to zero, and a test asserts that no setting of it reaches the
other tenant's data. A threshold is a preference; tenancy is a boundary.

Or drive it with curl.

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
being the right answer. The tokens above are demo tokens for a corpus of
synthetic text.

Workers AI on the free plan has a daily limit, and a public link with a text box
on it is an invitation to spend it. So the two routes that call a model are rate
limited per IP, 20 queries and 10 ingests a minute, counted in D1 and returned
as a 429 with `retry-after`. The limiter fails open: if its own table is
unavailable the request proceeds, because a demo that bans everyone to protect a
quota has protected nothing worth having. It is a fixed window, which means a
caller can send up to twice the limit across a boundary, and
[test/ratelimit.test.ts](test/ratelimit.test.ts) asserts that rather than
leaving it as a surprise. Expired rows are swept on a small fraction of
requests, off the response path.

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

    GET  /                    the demo page
    GET  /health              models, dimensions, topK, the threshold and the limits
    GET  /documents           what this tenant has ingested
    POST /ingest              { docId, text }                -> { chunks, ids }
    POST /query               { question, minScore? }        -> { answer, refused, citations, considered, minScore }

Everything except `/` and `/health` needs `Authorization: Bearer <token>`.

`minScore` is optional and overrides the configured threshold for one call.
Nonsense falls back to the default and out-of-range values are clamped, because
it is a preference rather than a permission: a bad preference should not cost
someone their answer. The applied value comes back in the response, so a result
can be reproduced.

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

### What it found

The harness is here because it earned its place. Run against the live deployment
on 2026-10-08, with `MIN_SCORE` at the 0.55 it had shipped with:

    retrieval:  5/5 cited the expected document
    grounding:  5/5 answers contained the expected fact
    refusal:    0/3 unanswerable questions were refused

All three questions the corpus could not answer were answered anyway. The two
flattering numbers were perfect and the one that matters was zero.

No unit test could have caught this. The tests embed text with a hashed bag of
words, so their scores are internally consistent but have no relationship to
what a real embedding model produces. Against `bge-base-en-v1.5` on this corpus,
loosely related text scores around 0.60 and genuinely relevant text starts
around 0.66, so 0.55 sat underneath the noise. Raising it to 0.65 took refusal
from 0/3 to 3/3 and cost one grounding point.

Both runs are committed under `eval/results/`. The failing one is the more
useful file: it is the evidence that the harness measures something.

### Why one run is not a measurement

Three consecutive runs at 0.65 agreed. That looked like confirmation. It wasn't.

Asking the same question four times by hand, against the same data, with the
same retrieval:

    answered  An expense of 200 needs finance approval before the money is spent [2].
    answered  ...would need finance approval... [2]
    refused   The context does not provide information on who approves an expense of 200.
    refused   The context does not provide enough information to determine who approves...

That question's top chunk scores 0.663 against a 0.65 threshold. Retrieval is
deterministic and clears the bar every time; generation is sampled, and at this
margin sampling decides the outcome. Three agreeing runs were three coin flips
landing the same way.

So the harness takes a repeat count, and a question passes only if it holds on
every call:

    REPEAT=5 npm run eval

A question that passes four times out of five is reported as `4/5` rather than
rounded to a verdict. The eval also waits out a 429 from its own rate limiter,
since at `REPEAT=5` it is a heavy enough caller to trip it. Both show up in the
run:

    answerable questions (5 calls each)
      OK  fact  top=0.790  How many days of paid holiday do staff get?
      OK  4/5   top=0.663  Who approves an expense of 200?
      OK  fact  top=0.696  How often are backups actually restored?
      OK  fact  top=0.671  How quickly must a suspected breach be reported?
      rate limited, waiting 20s
      OK  fact  top=0.680  How often are laptops replaced?

That `4/5` is the honest reading of the question at 0.663, and it is the only
one that moves. Everything else holds on all five calls, which is what tells you
the margin is the cause rather than the model being generally unreliable.

A fixed threshold is the crude form of this decision. Comparing the top score
against the gap to the next one would adapt better to a question whose whole
neighbourhood scores high. That is a change worth measuring rather than
assuming, which is the discipline that produced the number in the first place.

## What is deliberately not here

Deletion by document. Vectorize deletes by vector id, and it is a vector index
rather than a database you can scan by metadata, so "forget document X" needs a
docId to chunk-ids map in KV or D1. That is a real design decision an app has to
make, and implementing it badly here would look like a feature while missing
chunks.

Also not here: streaming responses, reranking, and hybrid keyword search. Each
is a reasonable next step; none of them change the four decisions above.

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
