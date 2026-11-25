/* UGC NET full-length mock test engine: Paper 1 + Paper 2 (Electronic Science).
   2 marks per question, no negative marking, user-set duration (default 180 min). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var params = new URLSearchParams(location.search);
  var n = parseInt(params.get('m'), 10) || 1;
  var pad = (n < 10 ? '0' : '') + n;
  var KEY = 'ugcnet-mock-' + pad;
  var LET = ['A', 'B', 'C', 'D'];
  var DEFAULT_MIN = 180;
  var app = $('#app');
  var M, S, tick, qStart;

  function store(get, val) {
    try { if (get) return JSON.parse(localStorage.getItem(KEY) || 'null'); localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) { return null; }
  }
  function best(v) {
    try { var o = JSON.parse(localStorage.getItem('ugcnet-best') || '{}'); if (v != null && (o[n] == null || v > o[n])) { o[n] = v; localStorage.setItem('ugcnet-best', JSON.stringify(o)); } return o[n]; } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function math(el) {
    if (window.renderMathInElement) {
      try { renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false, strict: false }); } catch (e) {}
    }
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function paperOf(i) { return M.qs[i].p; }
  function range(p) { var a = [], i; for (i = 0; i < M.qs.length; i++) if (M.qs[i].p === p) a.push(i); return a; }

  /* ---------- start screen with duration setting ---------- */
  function start() {
    var saved = store(true), b = best(), p1 = range(1).length, p2 = range(2).length;
    app.innerHTML =
      '<div class="start panel"><span class="pill">Full-length mock · Paper 1 + Paper 2</span><h1>' + esc(M.title) + '</h1>' +
      '<p class="sub">' + esc(M.sub) + '</p>' +
      '<div class="stats"><div class="stat"><b>' + M.qs.length + '</b><span>questions</span></div><div class="stat"><b>' + M.marks + '</b><span>total marks</span></div>' +
      '<div class="stat"><b>' + p1 + ' + ' + p2 + '</b><span>Paper 1 + Paper 2</span></div>' + (b != null ? '<div class="stat"><b>' + b + '</b><span>your best score</span></div>' : '') + '</div>' +
      '<div class="durbox"><label for="dur"><b>Set your test duration</b><small>Enter minutes (10–300). Leave blank for the standard ' + DEFAULT_MIN + ' minutes.</small></label>' +
      '<div class="durin"><input id="dur" type="number" min="10" max="300" step="5" placeholder="' + DEFAULT_MIN + '" inputmode="numeric"><span>minutes</span></div>' +
      '<div class="durq">' + [60, 90, 120, 180].map(function (x) { return '<button type="button" data-d="' + x + '">' + x + ' min</button>'; }).join('') + '</div></div>' +
      '<ul class="rules"><li>Paper 1 has ' + p1 + ' questions (General: teaching, research, reasoning, ICT, environment, higher education). Paper 2 has ' + p2 + ' questions on Electronic Science.</li>' +
      '<li>Each question carries ' + M.per + ' marks. There is <b>no negative marking</b>, so attempt every question.</li>' +
      '<li>Both papers are answered in one sitting with one timer, as in the computer-based UGC NET. Switch between papers at any time.</li>' +
      '<li>When you submit (or time runs out) you get your score, the complete answer key and an explanation for every question.</li>' +
      '<li>Your progress is saved in this browser, so you can close the page and resume.</li></ul>' +
      '<div class="nav">' + (saved && !saved.done ? '<button class="btn-p" id="bResume">Resume saved attempt (' + saved.ans.filter(function (x) { return x != null; }).length + ' answered, ' + fmt(saved.left) + ' left)</button>' : '') +
      (saved && saved.done ? '<button class="btn-p" id="bLast">View last result &amp; answer key</button>' : '') +
      '<button class="' + (saved && !saved.done ? '' : saved && saved.done ? '' : 'btn-p') + '" id="bGo">Start new test</button><a class="btn" href="../">All UGC NET mocks</a></div></div>';
    var din = $('#dur');
    app.querySelectorAll('.durq button').forEach(function (bt) { bt.onclick = function () { din.value = bt.dataset.d; }; });
    $('#bGo').onclick = function () {
      var v = parseInt(din.value, 10);
      if (din.value.trim() === '' || isNaN(v)) v = DEFAULT_MIN;
      if (v < 10 || v > 300) { alert('Please enter a duration between 10 and 300 minutes, or leave it blank for ' + DEFAULT_MIN + ' minutes.'); din.focus(); return; }
      S = { ans: M.qs.map(function () { return null; }), mk: M.qs.map(function () { return 0; }), vis: M.qs.map(function () { return 0; }),
            cur: 0, dur: v * 60, left: v * 60, done: false, spent: M.qs.map(function () { return 0; }) };
      S.vis[0] = 1; run();
    };
    if ($('#bResume')) $('#bResume').onclick = function () { S = saved; run(); };
    if ($('#bLast')) $('#bLast').onclick = function () { S = saved; result(); };
  }

  /* ---------- exam ---------- */
  function persist() { store(false, S); }
  function run() {
    qStart = Date.now();
    app.innerHTML =
      '<div class="exam"><div class="panel" id="qp"></div><aside class="side panel"><div class="timer" id="tm"></div><div class="tmsub" id="tms"></div>' +
      '<div class="ptabs"><button id="t1">Paper 1</button><button id="t2">Paper 2</button></div>' +
      '<div class="legend" style="justify-content:center"><span><i style="background:var(--ok);border-color:var(--ok)"></i>Answered</span><span><i style="background:var(--mark);border-color:var(--mark)"></i>Marked</span><span><i style="border-color:var(--bad)"></i>Not answered</span></div>' +
      '<div class="palette" id="pal"></div><div class="cnt" id="cnt"></div><div class="nav" style="justify-content:center"><button class="btn-p" id="bSub">Submit test</button></div></aside></div>';
    $('#t1').onclick = function () { go(range(1)[0]); };
    $('#t2').onclick = function () { go(range(2)[0]); };
    $('#bSub').onclick = function () {
      var un = S.ans.filter(function (x) { return x == null; }).length;
      if (confirm('Submit the test now? ' + un + ' question(s) are unanswered.')) finish();
    };
    $('#tms').textContent = 'of ' + Math.round(S.dur / 60) + ' min';
    $('#tm').textContent = fmt(S.left);
    clearInterval(tick);
    tick = setInterval(function () {
      S.left--; $('#tm').textContent = fmt(S.left); $('#tm').classList.toggle('low', S.left < 300);
      if (S.left % 10 === 0) persist();
      if (S.left <= 0) { clearInterval(tick); alert('Time is up. Your test will be submitted.'); finish(); }
    }, 1000);
    show(S.cur); drawPal();
  }
  function drawPal() {
    var p = $('#pal'), cp = paperOf(S.cur); p.innerHTML = '';
    $('#t1').className = cp === 1 ? 'on' : ''; $('#t2').className = cp === 2 ? 'on' : '';
    range(cp).forEach(function (i, k) {
      var b = document.createElement('button'), cls = 'pb';
      if (S.ans[i] != null && S.mk[i]) cls += ' am'; else if (S.ans[i] != null) cls += ' a'; else if (S.mk[i]) cls += ' m'; else if (S.vis[i]) cls += ' v';
      if (i === S.cur) cls += ' c';
      b.className = cls; b.textContent = k + 1; b.title = 'Paper ' + cp + ' · Q' + (k + 1); b.onclick = function () { go(i); };
      p.appendChild(b);
    });
    var a1 = range(1).filter(function (i) { return S.ans[i] != null; }).length, a2 = range(2).filter(function (i) { return S.ans[i] != null; }).length;
    $('#cnt').innerHTML = 'Answered: Paper 1 <b>' + a1 + '/' + range(1).length + '</b> · Paper 2 <b>' + a2 + '/' + range(2).length + '</b>';
  }
  function spend() { S.spent[S.cur] += (Date.now() - qStart) / 1000; qStart = Date.now(); }
  function go(i) { spend(); S.cur = i; S.vis[i] = 1; persist(); show(i); drawPal(); window.scrollTo({ top: 0 }); }
  function localNo(i) { return range(paperOf(i)).indexOf(i) + 1; }
  function qHTML(q, i, st) {
    var h = '<div class="qhead"><b>Paper ' + q.p + ' · Question ' + localNo(i) + '</b><span class="tag">' + M.per + ' marks</span><span class="tag">' + esc(q.t) + '</span></div>';
    if (q.f) h += '<div class="figbox">' + q.f + '</div>';
    h += '<div class="qtext">' + q.q + '</div><div class="opts">';
    q.o.forEach(function (o, k) {
      var c = 'opt';
      if (st.reveal) { if (k === q.a) c += ' ok'; else if (k === st.sel) c += ' no'; }
      else if (k === st.sel) c += ' sel';
      if (st.locked) c += ' locked';
      h += '<div class="' + c + '" data-k="' + k + '"><span class="k">' + LET[k] + '</span><span class="v">' + o + '</span></div>';
    });
    h += '</div>';
    if (st.reveal) h += '<div class="sol"><h4>Answer: ' + LET[q.a] + ' — explanation</h4>' + q.s + '</div>';
    return h;
  }
  function show(i) {
    var q = M.qs[i], pan = $('#qp'), last = i === M.qs.length - 1;
    pan.innerHTML = qHTML(q, i, { sel: S.ans[i], reveal: false, locked: false }) +
      '<div class="nav"><button id="bPrev"' + (i === 0 ? ' disabled' : '') + '>← Previous</button>' +
      '<button class="btn-p" id="bNext">' + (last ? 'Save' : 'Save &amp; Next →') + '</button>' +
      '<button class="btn-w" id="bMark">' + (S.mk[i] ? 'Unmark review' : 'Mark for review') + '</button>' +
      '<button id="bClr"' + (S.ans[i] == null ? ' disabled' : '') + '>Clear answer</button></div>';
    pan.querySelectorAll('.opt').forEach(function (el) {
      el.onclick = function () { S.ans[i] = parseInt(el.dataset.k, 10); persist(); show(i); drawPal(); };
    });
    $('#bPrev').onclick = function () { go(i - 1); };
    $('#bNext').onclick = function () { if (!last) go(i + 1); else { persist(); drawPal(); } };
    $('#bMark').onclick = function () { S.mk[i] = S.mk[i] ? 0 : 1; persist(); show(i); drawPal(); };
    $('#bClr').onclick = function () { S.ans[i] = null; persist(); show(i); drawPal(); };
    math(pan);
  }

  /* ---------- result + answer key ---------- */
  function finish() { clearInterval(tick); spend(); S.done = true; persist(); result(); }
  function score(idx) {
    var r = { sc: 0, ok: 0, wr: 0, sk: 0, mx: idx.length * M.per };
    idx.forEach(function (i) { if (S.ans[i] == null) r.sk++; else if (S.ans[i] === M.qs[i].a) { r.ok++; r.sc += M.per; } else r.wr++; });
    return r;
  }
  function keyTable(p) {
    var h = '<div class="keygrid">';
    range(p).forEach(function (i, k) {
      var q = M.qs[i], st = S.ans[i] == null ? 'sk' : S.ans[i] === q.a ? 'ok' : 'wr';
      h += '<a class="kc ' + st + '" href="#rv' + i + '" title="' + (st === 'ok' ? 'Correct' : st === 'wr' ? 'Wrong' : 'Not answered') + '"><span class="kn">' + (k + 1) + '</span><b>' + LET[q.a] + '</b><small>' + (S.ans[i] == null ? '–' : LET[S.ans[i]]) + '</small></a>';
    });
    return h + '</div>';
  }
  function result() {
    var all = score(M.qs.map(function (_, i) { return i; })), r1 = score(range(1)), r2 = score(range(2)), topics = {};
    M.qs.forEach(function (q, i) {
      var k = 'P' + q.p + ' · ' + q.t, t = topics[k] || (topics[k] = { n: 0, ok: 0, wr: 0, sk: 0 }); t.n++;
      if (S.ans[i] == null) t.sk++; else if (S.ans[i] === q.a) t.ok++; else t.wr++;
    });
    best(all.sc);
    var used = Math.round(S.dur - S.left);
    var rows = Object.keys(topics).sort(function (a, b) { return topics[a].ok / topics[a].n - topics[b].ok / topics[b].n; }).map(function (k) {
      var t = topics[k], pc = Math.round(100 * t.ok / t.n);
      return '<tr><td>' + esc(k) + '</td><td class="n">' + t.n + '</td><td class="n">' + t.ok + '</td><td class="n">' + t.wr + '</td><td class="n">' + t.sk + '</td><td class="n">' + t.ok * M.per + '</td><td><div class="bar"><i style="width:' + pc + '%"></i></div></td></tr>';
    }).join('');
    function card(lbl, r) { return '<div class="stat"><b>' + r.sc + ' / ' + r.mx + '</b><span>' + lbl + ' (' + r.ok + ' right, ' + r.wr + ' wrong, ' + r.sk + ' skipped)</span></div>'; }
    app.innerHTML =
      '<div class="panel"><span class="pill">Result</span><h1 style="margin-top:8px">' + esc(M.title) + '</h1>' +
      '<div class="big">' + all.sc + ' <span style="font-size:20px;color:var(--mut)">/ ' + M.marks + '</span></div>' +
      '<div class="rgrid">' + card('Paper 1', r1) + card('Paper 2', r2) +
      '<div class="stat"><b>' + (all.ok + all.wr ? Math.round(100 * all.ok / (all.ok + all.wr)) : 0) + '%</b><span>accuracy</span></div>' +
      '<div class="stat"><b>' + fmt(used) + '</b><span>time used of ' + Math.round(S.dur / 60) + ' min</span></div></div>' +
      '<div class="nav"><button class="btn-p" id="bRe">Retake this test</button><a class="btn" href="../">All UGC NET mocks</a><button id="bPr">Print answer key</button></div></div>' +
      '<div class="panel" id="akey"><h2>Answer key</h2><p class="sub">Large letter = correct answer, small letter = your answer. Green = correct, red = wrong, grey = not answered. Click a number to jump to its explanation.</p>' +
      '<h3>Paper 1</h3>' + keyTable(1) + '<h3>Paper 2</h3>' + keyTable(2) + '</div>' +
      '<div class="panel"><h3>Topic-wise performance (weakest first)</h3><div style="overflow-x:auto"><table class="tb"><tr><th>Topic</th><th class="n">Qs</th><th class="n">Right</th><th class="n">Wrong</th><th class="n">Skip</th><th class="n">Marks</th><th></th></tr>' + rows + '</table></div></div>' +
      '<h2 style="margin-top:26px">Review with explanations</h2><div class="filters" id="flt"></div><div id="rv"></div>';
    $('#bRe').onclick = function () { clearSaved(); start(); window.scrollTo({ top: 0 }); };
    $('#bPr').onclick = function () { window.print(); };
    var F = [['all', 'All (' + M.qs.length + ')'], ['p1', 'Paper 1'], ['p2', 'Paper 2'], ['wrong', 'Wrong (' + all.wr + ')'], ['skip', 'Unanswered (' + all.sk + ')'], ['good', 'Correct (' + all.ok + ')'], ['mark', 'Marked']];
    var cur = 'all';
    function render() {
      $('#flt').innerHTML = '';
      F.forEach(function (f) { var b = document.createElement('button'); b.textContent = f[1]; if (f[0] === cur) b.className = 'on'; b.onclick = function () { cur = f[0]; render(); }; $('#flt').appendChild(b); });
      var box = $('#rv'); box.innerHTML = '';
      var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { math(x.target); io.unobserve(x.target); } }); }, { rootMargin: '400px' }) : null;
      M.qs.forEach(function (q, i) {
        var st = S.ans[i] == null ? 'skip' : S.ans[i] === q.a ? 'good' : 'wrong';
        if (cur === 'p1' && q.p !== 1) return; if (cur === 'p2' && q.p !== 2) return;
        if (['wrong', 'skip', 'good'].indexOf(cur) >= 0 && cur !== st) return;
        if (cur === 'mark' && !S.mk[i]) return;
        var d = document.createElement('div'); d.className = 'rv ' + st; d.id = 'rv' + i;
        d.innerHTML = '<div class="st">' + (st === 'good' ? 'CORRECT' : st === 'wrong' ? 'WRONG — you chose ' + LET[S.ans[i]] : 'NOT ANSWERED') + '</div>' + qHTML(q, i, { sel: S.ans[i], reveal: true, locked: true });
        box.appendChild(d); if (io) io.observe(d); else math(d);
      });
      if (!box.children.length) box.innerHTML = '<p class="sub">Nothing in this category.</p>';
    }
    render(); window.scrollTo({ top: 0 });
  }

  /* ---------- boot ---------- */
  var sc = document.createElement('script');
  sc.src = 'data/mock' + pad + '.js';
  sc.onload = function () { M = window.MOCK; document.title = M.title + ' — UGC NET Paper 1 + Electronic Science | VIN Technologies'; $('#ttl').textContent = M.title; start(); };
  sc.onerror = function () { app.innerHTML = '<div class="panel start"><h1>Test not available</h1><p>Could not load mock test ' + n + '.</p><a class="btn" href="../">All UGC NET mocks</a></div>'; };
  document.head.appendChild(sc);
})();
