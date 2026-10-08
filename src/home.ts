/**
 * The page served at /.
 *
 * It exists because a demo link that returns 404 in a browser is worse than no
 * link: whoever opened it now believes the thing is broken, and they are not
 * going to open a terminal to find out otherwise.
 *
 * It is deliberately an attack surface rather than a description. The isolation
 * claim is the one worth doubting, so the page hands you globex's own wording
 * and invites you to ask acme for it. Reading the `considered` array afterwards
 * is the whole demonstration: globex's chunk is not in it, because it was never
 * scored.
 *
 * The demo tokens are in the page source and also in the README. They map to a
 * corpus of synthetic text on a free-plan deployment, and the tenancy they
 * select is resolved on the server, which is precisely what the page lets you
 * test.
 */
export const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cf-vectorize-rag</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #15171a; --muted: #5b6168;
    --line: #e3e6ea; --card: #f7f8fa; --accent: #1c6fd6; --warn: #a4571a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --fg: #e6e8eb; --muted: #9aa2ad;
      --line: #262b33; --card: #171a20; --accent: #6aa9f0; --warn: #d79b52;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 32px 0 10px; text-transform: uppercase;
       letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 12px; }
  .sub { color: var(--muted); margin-bottom: 20px; }
  a { color: var(--accent); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  button {
    font: inherit; font-size: 14px; padding: 7px 13px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  button[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: default; }
  input[type=text] {
    font: inherit; font-size: 14px; flex: 1 1 320px; min-width: 0; padding: 8px 11px;
    border-radius: 7px; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
  }
  .ask { font-size: 13px; color: var(--muted); display: block; margin: 10px 0 5px; }
  .ex { display: block; width: 100%; text-align: left; margin-bottom: 5px; line-height: 1.4; }
  pre {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; overflow-x: auto; margin: 12px 0 0; white-space: pre-wrap; word-break: break-word;
  }
  .note { color: var(--muted); font-size: 13.5px; }
  .warn { color: var(--warn); }
  ul { padding-left: 20px; margin: 0 0 12px; }
  li { margin-bottom: 6px; }
</style>
</head>
<body>
<main>

<h1>cf-vectorize-rag</h1>
<p class="sub">
  Multi-tenant retrieval on Cloudflare Workers AI. It cites what it used, refuses
  when the corpus cannot answer, and resolves tenancy on the server.
  <a href="https://github.com/mjhanzaibmemon/cf-vectorize-rag">Source on GitHub</a>.
</p>

<h2>Try to break the isolation</h2>

<p class="note">
  Two tenants share one deployment. Seed them, then ask <strong>acme</strong> for
  globex's secret using globex's own wording. Read <code>considered</code> in the
  response: globex's chunk is not in it. It was never scored, because the tenant
  filter runs inside the query rather than on the results.
</p>

<div class="card">
  <div class="row">
    <button id="seed">1. Seed both tenants</button>
    <span class="note" id="seedState"></span>
  </div>

  <div class="row">
    <span class="note">2. Ask as:</span>
    <button class="t" data-t="acme" aria-pressed="true">acme</button>
    <button class="t" data-t="globex" aria-pressed="false">globex</button>
  </div>

  <div class="row">
    <input type="text" id="q" value="How many days of paid holiday do staff receive each year?">
    <button id="ask">Ask</button>
  </div>

  <span class="ask">Or try one of these:</span>
  <button class="ex" data-q="How many days of paid holiday do staff receive each year?">Answerable by acme's handbook</button>
  <button class="ex" data-q="Where are the Globex launch codes stored in the Frankfurt vault?">
    <span class="warn">The cross-tenant one.</span> Ask it as acme.
  </button>
  <button class="ex" data-q="quantum submarine propeller certification schedule">Nothing in either corpus can answer this</button>

  <pre id="out">Seed the tenants, then ask something.</pre>
</div>

<h2>Endpoints</h2>
<ul>
  <li><code>GET /health</code> — no token required</li>
  <li><code>POST /ingest</code> — <code>{ docId, text }</code>, returns the chunk ids</li>
  <li><code>POST /query</code> — <code>{ question }</code>, returns the answer, citations and considered scores</li>
</ul>
<p class="note">
  All but <code>/health</code> need <code>Authorization: Bearer &lt;token&gt;</code>.
  A tenant in the request body is ignored; the token decides. Re-run
  <code>/ingest</code> with unchanged text and the ids come back identical.
</p>

<h2>What this deployment is not</h2>
<p class="note">
  The live index is D1 with cosine computed in the Worker, because Vectorize
  needs the Workers Paid plan. The application prefers Vectorize whenever the
  binding is present and switches without a code change. Workers AI has a daily
  free quota, so if everything starts failing, that is the quota rather than the
  retrieval. The corpus is synthetic.
</p>

</main>
<script>
(function () {
  var TOKENS = { acme: "demo_acme_7f3a91", globex: "demo_globex_2c8e45" };
  var DOCS = {
    acme: { docId: "handbook", text: "# Handbook\\n\\nStaff receive 25 days of paid holiday each year, plus public holidays. Unused holiday does not carry into the next year.\\n\\nExpenses under 50 pounds are approved by a line manager. Anything larger needs finance approval before the money is spent." },
    globex: { docId: "globex-internal", text: "# Globex internal\\n\\nThe Globex launch codes are stored in the vault in Frankfurt. Only the Globex operations team may rotate the Frankfurt vault keys." }
  };

  var tenant = "acme";
  var out = document.getElementById("out");
  var qBox = document.getElementById("q");

  function show(v) { out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); }

  function call(path, token, body) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + token },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  document.querySelectorAll(".t").forEach(function (b) {
    b.addEventListener("click", function () {
      tenant = b.dataset.t;
      document.querySelectorAll(".t").forEach(function (o) {
        o.setAttribute("aria-pressed", String(o === b));
      });
    });
  });

  document.querySelectorAll(".ex").forEach(function (b) {
    b.addEventListener("click", function () { qBox.value = b.dataset.q; qBox.focus(); });
  });

  document.getElementById("seed").addEventListener("click", function () {
    var btn = this, state = document.getElementById("seedState");
    btn.disabled = true; state.textContent = "seeding...";
    Promise.all([
      call("/ingest", TOKENS.acme, DOCS.acme),
      call("/ingest", TOKENS.globex, DOCS.globex)
    ]).then(function (r) {
      state.textContent = "done";
      btn.disabled = false;
      show({ acme: r[0], globex: r[1], note: "Press seed again: the ids do not change." });
    }).catch(function (e) {
      state.textContent = "failed";
      btn.disabled = false;
      show(String(e));
    });
  });

  document.getElementById("ask").addEventListener("click", function () {
    var q = qBox.value.trim();
    if (!q) return;
    show("asking as " + tenant + "...");
    call("/query", TOKENS[tenant], { question: q })
      .then(show)
      .catch(function (e) { show(String(e)); });
  });

  qBox.addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("ask").click();
  });
})();
</script>
</body>
</html>`;
