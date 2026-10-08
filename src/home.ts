/**
 * The page served at /.
 *
 * Two things it refuses to do, and both are the point.
 *
 * It does not hide the scores. A prettier answer bubble would bury the one
 * number that explains the system's behaviour, so the scores are drawn against
 * the threshold instead: when the app refuses, every mark sits left of the line
 * and the reason is visible rather than asserted.
 *
 * It does not pretend to be a product. This is a page for someone deciding
 * whether the engineering is sound, so the raw response stays one click away
 * and the deployment's limits are written on it.
 *
 * The demo tokens are in the source and in the README. They select tenancy on
 * a free-plan deployment holding synthetic text, which is exactly what the page
 * invites you to attack.
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
    --bg:#fbfbfc; --fg:#15171a; --muted:#646b74; --faint:#8b929b;
    --line:#e2e5ea; --card:#fff; --sunk:#f3f4f7;
    --accent:#1b6ed8; --good:#18794e; --warn:#b4530f; --danger:#b42318;
    --shadow:0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0d0f13; --fg:#e7e9ec; --muted:#98a0ab; --faint:#6e7681;
      --line:#242931; --card:#14171c; --sunk:#0f1216;
      --accent:#6aa9f0; --good:#4ec08a; --warn:#d79b52; --danger:#f0736a;
      --shadow:none;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  main { max-width:820px; margin:0 auto; padding:36px 16px 72px; }
  a { color:var(--accent); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.88em; }

  header { margin-bottom:26px; }
  h1 { font-size:23px; margin:0 0 6px; letter-spacing:-.015em; }
  .tag { color:var(--muted); font-size:14.5px; margin:0; }

  .panel {
    background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:18px; margin-bottom:16px; box-shadow:var(--shadow);
  }
  .ptitle {
    font-size:11.5px; text-transform:uppercase; letter-spacing:.08em;
    color:var(--faint); font-weight:650; margin:0 0 12px;
  }

  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .grow { flex:1 1 300px; min-width:0; }

  button {
    font:inherit; font-size:14px; padding:8px 14px; border-radius:8px;
    border:1px solid var(--line); background:var(--card); color:var(--fg);
    cursor:pointer; transition:border-color .12s, background .12s;
  }
  button:hover:not(:disabled) { border-color:var(--accent); }
  button:disabled { opacity:.45; cursor:default; }
  button.primary { background:var(--accent); color:#fff; border-color:var(--accent); font-weight:550; }
  button.primary:hover:not(:disabled) { filter:brightness(1.08); }
  button.ghost { background:transparent; color:var(--muted); border-color:transparent; padding:5px 8px; font-size:13px; }
  button.ghost:hover { color:var(--fg); }

  .seg { display:inline-flex; background:var(--sunk); border:1px solid var(--line); border-radius:9px; padding:3px; gap:3px; }
  .seg button { border:none; background:transparent; padding:6px 16px; border-radius:6px; font-weight:550; }
  .seg button[aria-pressed="true"] { background:var(--accent); color:#fff; }

  input[type=text], textarea {
    font:inherit; font-size:14px; width:100%; padding:9px 12px;
    border-radius:8px; border:1px solid var(--line);
    background:var(--bg); color:var(--fg); resize:vertical;
  }
  input[type=text]:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:-1px; border-color:transparent; }
  textarea { min-height:112px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; line-height:1.55; }
  label { display:block; font-size:12.5px; color:var(--muted); margin:0 0 5px; }

  .chip {
    font-size:13px; padding:5px 11px; border-radius:999px;
    border:1px solid var(--line); background:var(--sunk); color:var(--muted); cursor:pointer;
  }
  .chip:hover { border-color:var(--accent); color:var(--fg); }

  .docs { display:flex; flex-direction:column; gap:7px; margin-bottom:12px; }
  .doc {
    display:flex; justify-content:space-between; align-items:center; gap:10px;
    padding:9px 12px; background:var(--sunk); border-radius:8px; font-size:13.5px;
  }
  .doc .meta { color:var(--faint); font-size:12.5px; white-space:nowrap; }
  .empty { color:var(--faint); font-size:13.5px; padding:14px; text-align:center;
           border:1px dashed var(--line); border-radius:8px; margin-bottom:12px; }

  .answer { font-size:16.5px; line-height:1.65; margin:0 0 4px; }
  .verdict { display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:650;
             text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
  .verdict.ok { color:var(--good); }
  .verdict.no { color:var(--warn); }
  .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }

  .scale { margin:20px 0 6px; }
  .track { position:relative; height:42px; }
  .axis { position:absolute; left:0; right:0; top:26px; height:2px; background:var(--line); border-radius:2px; }
  .thresh { position:absolute; top:6px; bottom:6px; width:2px; background:var(--warn); opacity:.75; }
  .threshlabel { position:absolute; top:-2px; font-size:10.5px; color:var(--warn); white-space:nowrap; transform:translateX(-50%); font-weight:600; }
  .mark { position:absolute; top:19px; width:16px; height:16px; border-radius:50%;
          transform:translateX(-50%); border:2.5px solid var(--card); cursor:default; }
  .mark.used { background:var(--accent); }
  .mark.unused { background:var(--faint); }
  .ticks { display:flex; justify-content:space-between; font-size:10.5px; color:var(--faint); margin-top:-4px; }
  .legend { display:flex; gap:14px; font-size:12px; color:var(--muted); margin-top:10px; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .swatch { width:9px; height:9px; border-radius:50%; }

  .cite { border-left:2.5px solid var(--accent); padding:4px 0 4px 13px; margin:11px 0; }
  .cite .head { font-size:12.5px; color:var(--muted); margin-bottom:3px; }
  .cite .head b { color:var(--fg); font-weight:600; }
  .cite .ex { font-size:13.5px; color:var(--muted); line-height:1.55; }

  pre {
    background:var(--sunk); border:1px solid var(--line); border-radius:9px;
    padding:13px; overflow-x:auto; margin:10px 0 0; font-size:12.5px;
    white-space:pre-wrap; word-break:break-word; line-height:1.5;
  }
  .note { color:var(--muted); font-size:13px; line-height:1.6; }
  .hint { color:var(--faint); font-size:12.5px; margin-top:9px; }
  .hidden { display:none; }

  .slider { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
  .slider .val { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                 font-size:13px; font-weight:650; color:var(--accent); }
  input[type=range] { width:100%; margin:0; accent-color:var(--accent); height:20px; cursor:pointer; }
  .spin { display:inline-block; width:12px; height:12px; border:2px solid var(--line);
          border-top-color:var(--accent); border-radius:50%; animation:spin .7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  footer { margin-top:30px; }
  footer h3 { font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:var(--faint); margin:0 0 8px; }
</style>
</head>
<body>
<main>

<header>
  <h1>cf-vectorize-rag</h1>
  <p class="tag">
    Multi-tenant retrieval on Cloudflare Workers AI. It cites what it used, refuses
    when the corpus cannot answer, and resolves tenancy on the server.
    <a href="https://github.com/mjhanzaibmemon/cf-vectorize-rag">Source</a>
  </p>
</header>

<div class="panel">
  <p class="ptitle">You are asking as</p>
  <div class="row" style="justify-content:space-between">
    <div class="seg" id="seg">
      <button data-t="acme" aria-pressed="true">acme</button>
      <button data-t="globex" aria-pressed="false">globex</button>
    </div>
    <span class="note" id="who"></span>
  </div>
  <p class="hint">
    Tenancy comes from the bearer token, not from anything in the request body.
    Switching here switches the token the page sends.
  </p>
</div>

<div class="panel">
  <p class="ptitle">This tenant's corpus</p>
  <div id="docs" class="docs"></div>
  <div class="row">
    <button id="seed">Load the demo corpus</button>
    <button id="toggleAdd" class="ghost">+ Add your own document</button>
    <span class="note" id="corpusState"></span>
  </div>

  <div id="addBox" class="hidden" style="margin-top:14px">
    <label for="docId">Document name</label>
    <input type="text" id="docId" placeholder="my-policy" style="margin-bottom:11px">
    <label for="docText">Text</label>
    <textarea id="docText" placeholder="Paste any text. It gets chunked, embedded and stored against the tenant selected above."></textarea>
    <div class="row" style="margin-top:10px">
      <button id="add" class="primary">Ingest</button>
      <button id="cancelAdd" class="ghost">Cancel</button>
    </div>
    <p class="hint">
      Ingest the same text twice and the returned ids are identical, because a
      chunk id is a hash of tenant, document, position and content.
    </p>
  </div>
</div>

<div class="panel">
  <p class="ptitle">Ask</p>
  <div class="row">
    <input type="text" id="q" class="grow" value="How many days of paid holiday do staff receive each year?">
    <button id="ask" class="primary">Ask</button>
  </div>
  <div class="row" style="margin-top:11px">
    <button class="chip ex" data-q="How many days of paid holiday do staff receive each year?">answerable by acme</button>
    <button class="chip ex" data-q="Where are the Globex launch codes stored in the Frankfurt vault?">cross-tenant probe</button>
    <button class="chip ex" data-q="quantum submarine propeller certification schedule">nothing can answer this</button>
  </div>

  <div class="slider">
    <div class="row" style="justify-content:space-between; margin-bottom:5px">
      <label for="thr" style="margin:0">Confidence threshold</label>
      <span class="val" id="thrVal">0.55</span>
    </div>
    <input type="range" id="thr" min="0" max="1" step="0.01" value="0.55">
    <p class="hint" id="thrNote"></p>
  </div>
</div>

<div class="panel" id="result">
  <p class="ptitle">Result</p>
  <p class="note" id="placeholder">Load the corpus, then ask something.</p>

  <div id="out" class="hidden">
    <div class="verdict" id="verdict"></div>
    <p class="answer" id="answer"></p>

    <div class="scale">
      <div class="track" id="track"></div>
      <div class="ticks"><span>0.0</span><span>0.5</span><span>1.0</span></div>
      <div class="legend">
        <span><i class="swatch" style="background:var(--accent)"></i> used in the answer</span>
        <span><i class="swatch" style="background:var(--faint)"></i> retrieved, below threshold</span>
        <span><i class="swatch" style="background:var(--warn);border-radius:1px;width:3px;height:11px"></i> threshold</span>
      </div>
    </div>

    <div id="cites"></div>
    <button id="toggleRaw" class="ghost" style="margin-top:6px">Show raw response</button>
    <pre id="raw" class="hidden"></pre>
  </div>
</div>

<footer>
  <div class="panel">
    <h3>Endpoints</h3>
    <p class="note">
      <code>GET /health</code> needs no token.
      <code>GET /documents</code>, <code>POST /ingest</code> and <code>POST /query</code>
      need <code>Authorization: Bearer &lt;token&gt;</code>. A tenant in the request
      body is ignored; the token decides.
    </p>
    <h3 style="margin-top:16px">What this deployment is not</h3>
    <p class="note">
      The live index is D1 with cosine computed in the Worker, because Vectorize
      needs the Workers Paid plan. The application prefers Vectorize whenever the
      binding is present and switches without a code change. Workers AI has a
      daily free quota, so if everything starts failing, that is the quota rather
      than the retrieval. <code>/documents</code> reads D1 directly, because a
      vector index cannot be scanned by metadata; an app on Vectorize would keep
      its own document table. The seeded corpus is synthetic.
    </p>
  </div>
</footer>

</main>
<script>
(function () {
  var TOKENS = { acme: "demo_acme_7f3a91", globex: "demo_globex_2c8e45" };
  var DEFAULT_THRESHOLD = 0.55;
  var DEMO = {
    acme: { docId: "handbook", text: "# Handbook\\n\\nStaff receive 25 days of paid holiday each year, plus public holidays. Unused holiday does not carry into the next year.\\n\\nExpenses under 50 pounds are approved by a line manager. Anything larger needs finance approval before the money is spent." },
    globex: { docId: "globex-internal", text: "# Globex internal\\n\\nThe Globex launch codes are stored in the vault in Frankfurt. Only the Globex operations team may rotate the Frankfurt vault keys." }
  };

  var tenant = "acme";
  var $ = function (id) { return document.getElementById(id); };

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || "GET",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + TOKENS[tenant]
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- corpus ---------- */

  function refreshDocs() {
    $("who").textContent = "sending token for " + tenant;
    return api("/documents").then(function (r) {
      var box = $("docs"), docs = r.documents || [];
      if (!docs.length) {
        box.innerHTML = '<div class="empty">Nothing ingested for ' + esc(tenant) + ' yet.</div>';
        return;
      }
      box.innerHTML = docs.map(function (d) {
        return '<div class="doc"><span><b>' + esc(d.docId) + '</b></span>' +
               '<span class="meta">' + d.chunks + ' chunk' + (d.chunks === 1 ? "" : "s") +
               ' · ' + d.chars + ' chars</span></div>';
      }).join("");
    });
  }

  $("seg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    tenant = b.dataset.t;
    Array.prototype.forEach.call(this.querySelectorAll("button"), function (o) {
      o.setAttribute("aria-pressed", String(o === b));
    });
    refreshDocs();
  });

  $("seed").addEventListener("click", function () {
    var btn = this, s = $("corpusState");
    btn.disabled = true;
    s.innerHTML = '<span class="spin"></span>';
    api("/ingest", { method: "POST", body: DEMO[tenant] })
      .then(function (r) {
        s.textContent = "ingested " + (r.chunks || 0) + " chunk(s)";
        btn.disabled = false;
        return refreshDocs();
      })
      .catch(function (e) { s.textContent = "failed"; btn.disabled = false; });
  });

  $("toggleAdd").addEventListener("click", function () { $("addBox").classList.toggle("hidden"); });
  $("cancelAdd").addEventListener("click", function () { $("addBox").classList.add("hidden"); });

  $("add").addEventListener("click", function () {
    var id = $("docId").value.trim(), text = $("docText").value.trim();
    if (!id || !text) { $("corpusState").textContent = "name and text are both required"; return; }
    var btn = this, s = $("corpusState");
    btn.disabled = true;
    s.innerHTML = '<span class="spin"></span>';
    api("/ingest", { method: "POST", body: { docId: id, text: text } })
      .then(function (r) {
        btn.disabled = false;
        if (r.error) { s.textContent = r.error; return; }
        s.textContent = "ingested " + r.chunks + " chunk(s)";
        $("addBox").classList.add("hidden");
        $("docText").value = "";
        return refreshDocs();
      })
      .catch(function () { s.textContent = "failed"; btn.disabled = false; });
  });

  /* ---------- asking ---------- */

  Array.prototype.forEach.call(document.querySelectorAll(".ex"), function (b) {
    b.addEventListener("click", function () { $("q").value = b.dataset.q; $("q").focus(); });
  });

  function drawScale(considered, citedIds, threshold) {
    var track = $("track");
    var pct = (threshold * 100).toFixed(1) + "%";
    var html = '<div class="axis"></div>' +
      '<div class="thresh" style="left:' + pct + '"></div>' +
      '<div class="threshlabel" style="left:' + pct + '">' + threshold.toFixed(2) + '</div>';

    considered.forEach(function (c) {
      var used = citedIds.indexOf(c.id) !== -1;
      var left = Math.max(0, Math.min(1, c.score)) * 100;
      html += '<div class="mark ' + (used ? "used" : "unused") + '" style="left:' + left +
              '%" title="' + esc(c.id.slice(0, 12)) + ' scored ' + c.score + '"></div>';
    });
    track.innerHTML = html;
  }

  function render(r) {
    $("placeholder").classList.add("hidden");
    $("out").classList.remove("hidden");

    var v = $("verdict");
    if (r.refused) {
      v.className = "verdict no";
      v.innerHTML = '<i class="dot"></i> refused';
    } else {
      v.className = "verdict ok";
      v.innerHTML = '<i class="dot"></i> answered from ' + r.citations.length + ' source(s)';
    }

    $("answer").textContent = r.answer;

    var cited = (r.citations || []).map(function (c) { return c.id; });
    drawScale(r.considered || [], cited, typeof r.minScore === "number" ? r.minScore : DEFAULT_THRESHOLD);

    $("cites").innerHTML = (r.citations || []).map(function (c, i) {
      return '<div class="cite"><div class="head">[' + (i + 1) + '] <b>' + esc(c.docId) +
             '</b> · score ' + c.score + '</div><div class="ex">' + esc(c.excerpt) + '</div></div>';
    }).join("");

    $("raw").textContent = JSON.stringify(r, null, 2);
  }

  $("ask").addEventListener("click", function () {
    var q = $("q").value.trim();
    if (!q) return;
    var btn = this;
    btn.disabled = true;
    $("placeholder").classList.remove("hidden");
    $("placeholder").innerHTML = '<span class="spin"></span> asking as ' + esc(tenant) + '...';
    $("out").classList.add("hidden");

    api("/query", { method: "POST", body: { question: q, minScore: currentThreshold() } })
      .then(function (r) {
        btn.disabled = false;
        if (r.error) { $("placeholder").textContent = "error: " + r.error; return; }
        render(r);
      })
      .catch(function (e) { btn.disabled = false; $("placeholder").textContent = String(e); });
  });

  function currentThreshold() { return parseFloat($("thr").value); }

  /* The slider is the argument this project is making, so the label says what
     each end of it costs rather than leaving the visitor to infer it. */
  function describeThreshold(v) {
    if (v <= 0.2) return "Almost nothing is refused. Watch the cross-tenant probe start producing an answer assembled from whatever was nearest, which is how a confident wrong answer is born.";
    if (v < 0.5) return "Loose. More questions get answered, and more of those answers rest on weak context.";
    if (v <= 0.65) return "The configured default. Answers when the corpus supports it, refuses when it does not.";
    if (v < 0.9) return "Strict. Fewer wrong answers, and some questions the corpus could have answered are refused instead.";
    return "Almost everything is refused, including questions the corpus answers well.";
  }

  $("thr").addEventListener("input", function () {
    var v = currentThreshold();
    $("thrVal").textContent = v.toFixed(2);
    $("thrNote").textContent = describeThreshold(v);
  });

  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") $("ask").click(); });
  $("toggleRaw").addEventListener("click", function () {
    var pre = $("raw"), open = !pre.classList.contains("hidden");
    pre.classList.toggle("hidden");
    this.textContent = open ? "Show raw response" : "Hide raw response";
  });

  $("thrNote").textContent = describeThreshold(DEFAULT_THRESHOLD);
  refreshDocs();
})();
</script>
</body>
</html>`;
