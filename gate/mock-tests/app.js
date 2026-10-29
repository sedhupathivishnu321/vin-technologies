/* GATE ECE - Networks, Signals & Systems chapter mock test engine (works from file://) */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var params = new URLSearchParams(location.search);
  var n = parseInt(params.get('c'), 10) || 1;
  var pad = (n < 10 ? '0' : '') + n;
  var S0 = params.get('s') || 'nss';
  var KEY = 'mock-' + S0 + '-' + pad;
  var LET = ['A', 'B', 'C', 'D'];
  var app = $('#app');
  var M, S;

  function store(get, val) {
    try { if (get) return JSON.parse(localStorage.getItem(KEY) || 'null'); localStorage.setItem(KEY, JSON.stringify(val)); } catch (e) { return null; }
  }
  function best(v) { try { var o = JSON.parse(localStorage.getItem('mock-best') || '{}'); var K = S0 + n; if (v != null) { if (o[K] == null || v > o[K]) o[K] = v; localStorage.setItem('mock-best', JSON.stringify(o)); } return o[K]; } catch (e) { return null; } }
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
  function neg(q) { return q.m === 2 ? 2 / 3 : 1 / 3; }

  /* ---------- start screen ---------- */
  function start() {
    var saved = store(true);
    var b = best();
    app.innerHTML =
      '<div class="start panel"><span class="pill">Chapter ' + n + ' · Mock Test</span><h1>' + esc(M.title) + '</h1>' +
      '<p class="sub">' + esc(M.stitle) + ' · GATE ECE</p>' +
      '<div class="stats"><div class="stat"><b>' + M.qs.length + '</b><span>MCQs</span></div><div class="stat"><b>' + M.marks + '</b><span>total marks</span></div>' +
      '<div class="stat"><b>' + Math.round(M.qs.length * 1.2) + ' min</b><span>exam duration</span></div>' + (b != null ? '<div class="stat"><b>' + b.toFixed(2) + '</b><span>your best score</span></div>' : '') + '</div>' +
      '<div class="modes"><label class="mode on" id="mExam"><input type="radio" name="mode" value="exam" checked><b>Exam mode</b><small>Timed. Answers and full solutions are revealed after you submit.</small></label>' +
      '<label class="mode" id="mPrac"><input type="radio" name="mode" value="practice"><b>Practice mode</b><small>No timer. Each question shows its worked solution as soon as you answer.</small></label></div>' +
      '<ul class="rules"><li>Every question is a single-answer MCQ with four choices; circuits and graphs are drawn in the figure.</li>' +
      '<li>Marking as in GATE: 1-mark questions lose ⅓ for a wrong answer, 2-mark questions lose ⅔. Unanswered questions score 0.</li>' +
      '<li>Your progress is saved in this browser, so you can close the page and resume.</li></ul>' +
      '<div class="nav">' + (saved && !saved.done ? '<button class="btn-p" id="bResume">Resume saved attempt (' + saved.ans.filter(function (x) { return x != null; }).length + ' answered)</button>' : '') +
      '<button class="' + (saved && !saved.done ? '' : 'btn-p') + '" id="bGo">Start new test</button><a class="btn" href="index.html#' + S0 + '">All chapters</a></div></div>';
    var modes = app.querySelectorAll('input[name=mode]');
    modes.forEach(function (i) { i.onchange = function () { $('#mExam').classList.toggle('on', modes[0].checked); $('#mPrac').classList.toggle('on', modes[1].checked); }; });
    $('#bGo').onclick = function () {
      var mode = modes[1].checked ? 'practice' : 'exam';
      S = { mode: mode, ans: M.qs.map(function () { return null; }), mk: M.qs.map(function () { return 0; }), vis: M.qs.map(function () { return 0; }), cur: 0, left: Math.round(M.qs.length * 72), t0: Date.now(), done: false, spent: M.qs.map(function () { return 0; }) };
      S.vis[0] = 1; run();
    };
    if ($('#bResume')) $('#bResume').onclick = function () { S = saved; run(); };
  }

  /* ---------- exam ---------- */
  var tick, qStart;
  function persist() { store(false, S); }
  function run() {
    qStart = Date.now();
    app.innerHTML =
      '<div class="exam"><div class="panel" id="qp"></div><aside class="side panel"><div class="timer" id="tm"></div>' +
      '<div class="legend" style="justify-content:center"><span><i style="background:var(--ok);border-color:var(--ok)"></i>Answered</span><span><i style="background:var(--mark);border-color:var(--mark)"></i>Marked</span><span><i style="border-color:var(--bad)"></i>Not answered</span></div>' +
      '<div class="palette" id="pal"></div><div class="nav" style="justify-content:center"><button class="btn-p" id="bSub">Submit test</button></div></aside></div>';
    $('#bSub').onclick = function () {
      var un = S.ans.filter(function (x) { return x == null; }).length;
      if (confirm(S.mode === 'exam' ? 'Submit the test now? ' + un + ' question(s) are unanswered.' : 'Finish practice and see the result? ' + un + ' unanswered.')) finish();
    };
    drawPal();
    if (S.mode === 'exam') {
      $('#tm').textContent = fmt(S.left);
      clearInterval(tick);
      tick = setInterval(function () {
        S.left--; $('#tm').textContent = fmt(S.left); $('#tm').classList.toggle('low', S.left < 300);
        if (S.left % 10 === 0) persist();
        if (S.left <= 0) { clearInterval(tick); alert('Time is up. Your test will be submitted.'); finish(); }
      }, 1000);
    } else { $('#tm').innerHTML = '<span style="font-size:15px;font-weight:600">Practice mode<br><small style="font-weight:400;color:var(--mut)">no time limit</small></span>'; }
    show(S.cur);
  }
  function drawPal() {
    var p = $('#pal'); p.innerHTML = '';
    M.qs.forEach(function (q, i) {
      var b = document.createElement('button');
      var cls = 'pb';
      if (S.ans[i] != null && S.mk[i]) cls += ' am'; else if (S.ans[i] != null) cls += ' a'; else if (S.mk[i]) cls += ' m'; else if (S.vis[i]) cls += ' v';
      if (i === S.cur) cls += ' c';
      b.className = cls; b.textContent = i + 1; b.onclick = function () { go(i); };
      p.appendChild(b);
    });
  }
  function spend() { S.spent[S.cur] += (Date.now() - qStart) / 1000; qStart = Date.now(); }
  function go(i) { spend(); S.cur = i; S.vis[i] = 1; persist(); show(i); drawPal(); window.scrollTo({ top: 0 }); }
  function qHTML(q, i, st) {
    // st: {sel, reveal, locked}
    var h = '<div class="qhead"><b>Question ' + (i + 1) + ' of ' + M.qs.length + '</b><span class="tag">' + q.m + (q.m === 1 ? ' mark' : ' marks') + '</span><span class="tag">' + esc(q.t) + '</span></div>';
    h += '<div class="qtext">' + q.q + '</div>';
    if (q.f) h += '<div class="figbox">' + q.f + '</div>';
    h += '<div class="opts">';
    q.o.forEach(function (o, k) {
      var c = 'opt';
      if (st.reveal) { if (k === q.a) c += ' ok'; else if (k === st.sel) c += ' no'; }
      else if (k === st.sel) c += ' sel';
      if (st.locked) c += ' locked';
      h += '<div class="' + c + '" data-k="' + k + '"><span class="k">' + LET[k] + '</span><span class="v">' + o + '</span></div>';
    });
    h += '</div>';
    if (st.reveal) h += '<div class="sol"><h4>Answer: ' + LET[q.a] + ' — solution</h4>' + q.s + '</div>';
    return h;
  }
  function show(i) {
    var q = M.qs[i], pan = $('#qp');
    var reveal = S.mode === 'practice' && S.ans[i] != null;
    pan.innerHTML = qHTML(q, i, { sel: S.ans[i], reveal: reveal, locked: reveal }) +
      '<div class="nav"><button id="bPrev"' + (i === 0 ? ' disabled' : '') + '>← Previous</button>' +
      '<button class="btn-p" id="bNext">' + (i === M.qs.length - 1 ? 'Save' : 'Save &amp; Next →') + '</button>' +
      '<button class="btn-w" id="bMark">' + (S.mk[i] ? 'Unmark review' : 'Mark for review') + '</button>' +
      '<button id="bClr"' + (S.ans[i] == null || reveal ? ' disabled' : '') + '>Clear answer</button></div>';
    pan.querySelectorAll('.opt').forEach(function (e) {
      e.onclick = function () {
        if (S.mode === 'practice' && S.ans[i] != null) return;
        S.ans[i] = parseInt(e.dataset.k, 10); persist(); show(i); drawPal();
      };
    });
    $('#bPrev').onclick = function () { go(i - 1); };
    $('#bNext').onclick = function () { if (i < M.qs.length - 1) go(i + 1); else { persist(); drawPal(); } };
    $('#bMark').onclick = function () { S.mk[i] = S.mk[i] ? 0 : 1; persist(); show(i); drawPal(); };
    $('#bClr').onclick = function () { S.ans[i] = null; persist(); show(i); drawPal(); };
    math(pan);
  }

  /* ---------- result ---------- */
  function finish() {
    clearInterval(tick); spend(); S.done = true; S.t1 = Date.now(); persist();
    result();
  }
  function result() {
    var sc = 0, ok = 0, wr = 0, sk = 0, topics = {};
    M.qs.forEach(function (q, i) {
      var t = topics[q.t] || (topics[q.t] = { n: 0, ok: 0, wr: 0, sk: 0, sc: 0, mx: 0 }); t.n++; t.mx += q.m;
      if (S.ans[i] == null) { sk++; t.sk++; }
      else if (S.ans[i] === q.a) { ok++; t.ok++; sc += q.m; t.sc += q.m; }
      else { wr++; t.wr++; sc -= neg(q); t.sc -= neg(q); }
    });
    best(sc);
    var used = S.mode === 'exam' ? Math.round(M.qs.length * 72 - S.left) : S.spent.reduce(function (a, b) { return a + b; }, 0);
    var rows = Object.keys(topics).sort(function (a, b) { return topics[a].ok / topics[a].n - topics[b].ok / topics[b].n; }).map(function (k) {
      var t = topics[k], pc = Math.round(100 * t.ok / t.n);
      return '<tr><td>' + esc(k) + '</td><td class="n">' + t.n + '</td><td class="n">' + t.ok + '</td><td class="n">' + t.wr + '</td><td class="n">' + t.sk + '</td><td class="n">' + t.sc.toFixed(2) + '</td><td><div class="bar"><i style="width:' + pc + '%"></i></div></td></tr>';
    }).join('');
    app.innerHTML =
      '<div class="panel"><span class="pill">Result · Chapter ' + n + '</span><h1 style="margin-top:8px">' + esc(M.title) + '</h1>' +
      '<div class="big">' + sc.toFixed(2) + ' <span style="font-size:20px;color:var(--mut)">/ ' + M.marks + '</span></div>' +
      '<div class="rgrid"><div class="stat"><b style="color:var(--ok)">' + ok + '</b><span>correct</span></div><div class="stat"><b style="color:var(--bad)">' + wr + '</b><span>wrong</span></div><div class="stat"><b style="color:var(--warn)">' + sk + '</b><span>unanswered</span></div>' +
      '<div class="stat"><b>' + (ok + wr ? Math.round(100 * ok / (ok + wr)) : 0) + '%</b><span>accuracy</span></div><div class="stat"><b>' + fmt(used) + '</b><span>time used</span></div></div>' +
      '<h3>Topic-wise performance (weakest first)</h3><div style="overflow-x:auto"><table class="tb"><tr><th>Topic</th><th class="n">Qs</th><th class="n">Right</th><th class="n">Wrong</th><th class="n">Skip</th><th class="n">Marks</th><th></th></tr>' + rows + '</table></div>' +
      '<div class="nav"><button class="btn-p" id="bRe">Retake this test</button><a class="btn" href="index.html#' + S0 + '">All chapters</a></div></div>' +
      '<h2 style="margin-top:26px">Review with solutions</h2><div class="filters" id="flt"></div><div id="rv"></div>';
    $('#bRe').onclick = function () { clearSaved(); start(); window.scrollTo({ top: 0 }); };
    var F = [['all', 'All (' + M.qs.length + ')'], ['wrong', 'Wrong (' + wr + ')'], ['skip', 'Unanswered (' + sk + ')'], ['good', 'Correct (' + ok + ')'], ['mark', 'Marked']];
    var cur = wr ? 'wrong' : 'all';
    function render() {
      $('#flt').innerHTML = '';
      F.forEach(function (f) { var b = document.createElement('button'); b.textContent = f[1]; if (f[0] === cur) b.className = 'on'; b.onclick = function () { cur = f[0]; render(); }; $('#flt').appendChild(b); });
      var box = $('#rv'); box.innerHTML = '';
      var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { math(e.target); io.unobserve(e.target); } }); }, { rootMargin: '400px' }) : null;
      M.qs.forEach(function (q, i) {
        var st = S.ans[i] == null ? 'skip' : S.ans[i] === q.a ? 'good' : 'wrong';
        if (cur !== 'all' && cur !== st && !(cur === 'mark' && S.mk[i])) return;
        var d = document.createElement('div'); d.className = 'rv ' + st;
        d.innerHTML = '<div class="st">' + (st === 'good' ? 'CORRECT' : st === 'wrong' ? 'WRONG — you chose ' + LET[S.ans[i]] : 'NOT ANSWERED') + '</div>' + qHTML(q, i, { sel: S.ans[i], reveal: true, locked: true });
        box.appendChild(d); if (io) io.observe(d); else math(d);
      });
      if (!box.children.length) box.innerHTML = '<p class="sub">Nothing in this category.</p>';
    }
    render(); window.scrollTo({ top: 0 });
  }

  /* ---------- boot ---------- */
  var sc = document.createElement('script');
  sc.src = 'data/' + S0 + '/ch' + pad + '.js';
  sc.onload = function () {
    M = window.MOCK; document.title = 'Ch ' + n + ' · ' + M.title + ' — Mock Test';
    $('#ttl').textContent = M.stitle + ' · Ch ' + n;
    var bk = document.getElementById('back'); if (bk) bk.href = 'index.html#' + S0;
    var s = store(true);
    start();
  };
  sc.onerror = function () { app.innerHTML = '<div class="panel start"><h1>Test not available</h1><p>Could not load data for chapter ' + n + '.</p><a class="btn" href="index.html#' + S0 + '">All chapters</a></div>'; };
  document.head.appendChild(sc);
})();
