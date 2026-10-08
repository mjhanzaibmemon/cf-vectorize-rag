# Eval runs

These are kept, including the ones that failed, because a harness nobody has
watched fail is not evidence of anything.

Read them in this order.

`2026-10-08-threshold-0.55-failed.txt`
: The run that justified the harness. Retrieval 5/5, grounding 5/5, refusal
  **0/3**. Every question the corpus could not answer was answered anyway. The
  threshold had shipped at 0.55, which on this corpus sits below the score that
  loosely related text reaches, so nothing ever refused.

`2026-10-08-threshold-0.65-passed.txt`
: The same eval after raising `MIN_SCORE` to 0.65. Refusal 3/3, and grounding
  drops to 4/5. That is the trade, measured rather than guessed.

`2026-10-08-threshold-0.65-run2.txt`, `-run3.txt`
: Two more runs that agreed. They look like confirmation. They are not: see the
  next two files.

`2026-10-08-threshold-0.65-repeat-5-hit-its-own-rate-limit.txt`
: The first attempt at five calls per question, which died on a 429 from the
  rate limiter added the same day. The harness was a heavy enough caller to trip
  the demo's own protection, which is worth knowing about a load generator.

`2026-10-09-threshold-0.65-repeat-5.txt`
: Five calls per question, with the harness now waiting out a 429. One question
  reports `4/5`: its top chunk scores 0.663 against a 0.65 threshold, and at
  that margin sampling in the generation step decides whether the answer
  survives. The three agreeing runs above were three coin flips landing the same
  way.
