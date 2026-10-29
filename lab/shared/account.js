/* LEARNERS LAB shared account + storage layer (classic script, no dependencies).
 *  1. Caps everything the simulators keep in this browser (localStorage) at LL_CONFIG.cacheLimitMB; oldest entries are evicted first.
 *  2. Optional "Sign in with Google": the user's projects are copied to a private app folder in THEIR OWN Google Drive
 *     (scope drive.appdata). Nothing is sent to VIN Technologies or GitHub. Without a client id in config.js the button stays hidden. */
(function () {
  "use strict";
  var CFG = window.LL_CONFIG || {};
  var LIMIT = Math.round((CFG.cacheLimitMB || 8) * 1024 * 1024);
  var MANAGED = /^(circuitlab\.|ll-|ll:)/;
  var SYNCED = /^(circuitlab\.autosave|ll-trainer:(src|exp):)/;
  var META_KEY = "ll:meta";
  var ls;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }
  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;

  // ---------------------------------------------------------------- capped cache
  function meta() { try { return JSON.parse(ls.getItem(META_KEY) || "{}"); } catch (e) { return {}; } }
  function saveMeta(m) { try { rawSet.call(ls, META_KEY, JSON.stringify(m)); } catch (e) { /* full */ } }
  function sizeOf(k) { var v = ls.getItem(k); return v === null ? 0 : (k.length + v.length) * 2; }
  function managedKeys() { var out = []; for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (MANAGED.test(k) && k !== META_KEY) out.push(k); } return out; }
  function used() { return managedKeys().reduce(function (n, k) { return n + sizeOf(k); }, 0); }
  function evictFor(extra, keep) {
    var m = meta(), keys = managedKeys().filter(function (k) { return k !== keep && !/theme/.test(k); });
    keys.sort(function (a, b) { return (m[a] || 0) - (m[b] || 0); });
    var total = used() + extra;
    while (total > LIMIT && keys.length) { var k = keys.shift(); total -= sizeOf(k); rawRemove.call(ls, k); delete m[k]; }
    saveMeta(m);
    return total <= LIMIT;
  }
  Storage.prototype.setItem = function (k, v) {
    if (this !== ls || !MANAGED.test(k) || k === META_KEY) return rawSet.call(this, k, v);
    var add = (k.length + String(v).length) * 2, old = sizeOf(k);
    if (add > LIMIT) throw new DOMException("LEARNERS LAB cache limit (" + (LIMIT / 1048576) + " MB) exceeded by a single item", "QuotaExceededError");
    if (used() - old + add > LIMIT && !evictFor(add - old, k)) throw new DOMException("LEARNERS LAB cache limit exceeded", "QuotaExceededError");
    rawSet.call(this, k, v);
    var m = meta(); m[k] = Date.now(); saveMeta(m);
    if (SYNCED.test(k)) schedulePush();
  };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === ls && MANAGED.test(k)) { var m = meta(); delete m[k]; saveMeta(m); } };
  // trim anything left over from before the limit existed
  try { if (used() > LIMIT) evictFor(0, null); } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- UI
  var CLIENT = CFG.googleClientId || "";
  var st = { state: "out", email: "", name: "", token: "", pushT: 0, last: "", fileId: "" };
  try { var saved = JSON.parse(ls.getItem("ll:acct") || "null"); if (saved) { st.email = saved.email; st.name = saved.name; st.state = "idle"; } } catch (e) { /* ignore */ }
  var el = {};
  function h(tag, a, kids) { var e = document.createElement(tag); for (var k in a || {}) e.setAttribute(k, a[k]); (kids || []).forEach(function (c) { e.append(c.nodeType ? c : document.createTextNode(c)); }); return e; }
  function mb(n) { return (n / 1048576).toFixed(2); }

  function css() {
    var s = h("style", {}, [".llacct{position:relative;flex:none;font:13px/1.4 system-ui,'Segoe UI',sans-serif}.llacct.fixed{position:fixed;right:10px;bottom:10px;z-index:90}" +
      ".llacct>button.main{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:6px;border:1px solid var(--line,#d9dfe8);background:var(--panel,#fff);color:var(--text,#1c2430);cursor:pointer;white-space:nowrap;font:inherit;font-weight:500}" +
      ".llacct>button.main:hover{border-color:var(--acc,#2f6fed)}.llacct .dot{width:8px;height:8px;border-radius:50%;background:#7b838d}.llacct .dot.ok{background:#1f9d55}.llacct .dot.busy{background:#f08c00}.llacct .dot.err{background:#e5383b}" +
      ".llacct .avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--acc,#2f6fed);color:#fff;font-size:12px;font-weight:700}.llacct .avatar.out{background:var(--line,#d9dfe8);color:var(--mute,#6b7686)}.llacct.site{margin-left:12px}.llpop{position:absolute;right:0;top:36px;width:290px;background:var(--panel,#fff);color:var(--text,#1c2430);border:1px solid var(--line,#d9dfe8);border-radius:10px;box-shadow:0 12px 32px rgba(20,30,50,.25);padding:12px;z-index:200}" +
      ".llacct.fixed .llpop{top:auto;bottom:36px}.llpop p{margin:0 0 8px}.llpop small{color:var(--mute,#6b7686);display:block;margin-bottom:8px}" +
      ".llpop button{height:28px;padding:0 10px;margin:2px 4px 2px 0;border-radius:6px;border:1px solid var(--line,#d9dfe8);background:var(--panel,#fff);color:inherit;cursor:pointer;font:inherit}.llpop button.pri{background:var(--acc,#2f6fed);border-color:var(--acc,#2f6fed);color:#fff}" +
      ".llpop{width:240px;top:40px;border-radius:12px;padding:14px;box-shadow:0 14px 36px rgba(20,30,50,.2);text-align:left}.llpop small{font-size:12px;margin:0}.llpop .who{display:flex;flex-direction:column;margin-bottom:4px}.llpop .who span{color:var(--mute,#6b7686);font-size:12px;overflow:hidden;text-overflow:ellipsis}.llpop .stat{font-size:12px;color:var(--mute,#6b7686);margin-bottom:10px}.llpop .btns{display:flex;gap:6px;margin-bottom:12px}.llpop .legal{margin-top:10px;text-align:center}.llpop .legal a{color:inherit}.llpop button{height:32px;padding:0 12px;margin:0;border-radius:8px;font-weight:500;flex:1}.llpop button.wide{width:100%}.llbar{height:4px;margin:2px 0 6px}" +
      ".llbar{height:6px;border-radius:3px;background:var(--line,#d9dfe8);overflow:hidden;margin:4px 0 8px}.llbar i{display:block;height:100%;background:var(--acc,#2f6fed)}" +
      ".lltoast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:var(--panel,#fff);color:var(--text,#1c2430);border:1px solid var(--line,#d9dfe8);border-radius:8px;box-shadow:0 12px 32px rgba(20,30,50,.25);padding:8px 14px;z-index:300;font:13px system-ui,sans-serif}.lltoast button{margin-left:10px;border:1px solid var(--line,#d9dfe8);background:var(--acc,#2f6fed);color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer}"]);
    document.head.append(s);
  }
  function toast(msg, action, fn) {
    var t = h("div", { "class": "lltoast", role: "status" }, [msg]);
    if (action) { var b = h("button", { type: "button" }, [action]); b.onclick = function () { t.remove(); fn(); }; t.append(b); }
    document.body.append(t); setTimeout(function () { t.remove(); }, action ? 15000 : 4000);
  }
  function label() { return st.state === "out" ? "Sign in" : st.email ? st.email.split("@")[0] : "Account"; }
  function render() {
    if (!el.btn) return;
    var cls = st.state === "ready" ? "ok" : st.state === "busy" ? "busy" : st.state === "error" || st.state === "expired" ? "err" : "";
    el.btn.innerHTML = "";
    if (st.state === "out") el.btn.append(h("span", { "class": "avatar out" }, ["☺"]), h("span", { "class": "lbl" }, ["Sign in"])); else el.btn.append(h("span", { "class": "avatar" }, [(st.name || st.email || "?").charAt(0).toUpperCase()]), h("span", { "class": "dot " + cls }), h("span", { "class": "lbl" }, [label()]));
    el.btn.title = st.state === "out" ? "Sign in with Google" : st.state === "ready" ? "Synced with your Google Drive" : st.state === "expired" ? "Session expired: click to reconnect" : "Account";
    if (!el.pop.hidden) renderPop();
  }
  function renderPop() {
    var p = el.pop; p.innerHTML = "";
    var u = used(), pct = Math.min(100, (u / LIMIT) * 100);
    if (st.state === "out") {
      var b = h("button", { "class": "pri wide", type: "button" }, ["Continue with Google"]); b.onclick = signIn; p.append(b);
    } else {
      p.append(h("div", { "class": "who" }, [h("b", {}, [st.name || st.email.split("@")[0]]), h("span", {}, [st.email])]));
      var status = st.state === "ready" ? "Synced" + (st.last ? " " + st.last : "") : st.state === "busy" ? "Syncing…" : st.state === "expired" ? "Session expired" : st.state === "error" ? "Sync failed" : "Not connected";
      p.append(h("div", { "class": "stat" }, [status]));
      var row = h("div", { "class": "btns" });
      if (st.state === "idle" || st.state === "expired") { var r = h("button", { "class": "pri", type: "button" }, ["Reconnect"]); r.onclick = signIn; row.append(r); }
      else { var s = h("button", { type: "button" }, ["Sync now"]); s.onclick = function () { pull(true); }; row.append(s); }
      var o = h("button", { type: "button" }, ["Sign out"]); o.onclick = signOut; row.append(o);
      p.append(row);
      p.append(h("div", { "class": "llbar", title: "Browser storage" }, [h("i", { style: "width:" + pct + "%" })]), h("small", {}, [mb(u) + " / " + mb(LIMIT) + " MB stored in this browser"]));
    }
    p.append(h("small", { "class": "legal" }, [h("a", { href: "/privacy/", target: "_blank", rel: "noopener" }, ["Privacy"]), " · ", h("a", { href: "/terms/", target: "_blank", rel: "noopener" }, ["Terms"])]));
  }
  // ---------------------------------------------------------------- sign-in gate (config: requireSignIn)
  function showGate() {
    if (el.gate) return;
    el.gate = h("div", { id: "llgate", role: "dialog", "aria-modal": "true", "aria-label": "Sign in required", style: "position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg,#f3f5f8);font:14px/1.5 system-ui,'Segoe UI',sans-serif;color:var(--text,#1c2430)" });
    var card = h("div", { style: "max-width:340px;width:100%;background:var(--panel,#fff);border:1px solid var(--line,#d9dfe8);border-radius:14px;box-shadow:0 12px 32px rgba(20,30,50,.18);padding:28px 26px;text-align:center" });
    var btn = h("button", { type: "button", style: "margin-top:18px;height:42px;width:100%;padding:0 22px;border-radius:8px;border:0;background:var(--acc,#2f6fed);color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer" }, ["Sign in with Google"]);
    btn.onclick = signIn;
    var title = (document.title || "LEARNERS LAB").split("|")[0].split("—")[0].trim();
    card.append(h("img", { src: "/assets/icon-192.png", alt: "", width: "56", height: "56", style: "border-radius:14px;display:block;margin:0 auto 12px" }),
      h("h2", { style: "margin:0;font-size:20px" }, ["Sign in to continue"]), btn,
      h("p", { style: "margin:14px 0 0;font-size:12px;color:var(--mute,#6b7686)" }, [h("a", { href: "/privacy/", target: "_blank", rel: "noopener" }, ["Privacy"]), " · ", h("a", { href: "/terms/", target: "_blank", rel: "noopener" }, ["Terms"])]));
    el.gate.append(card);
    document.documentElement.append(el.gate);
    document.body.setAttribute("inert", "");
  }
  function hideGate() { if (el.gate) { el.gate.remove(); el.gate = null; document.body.removeAttribute("inert"); } }

  function mount() {
    css();
    el.root = h("div", { "class": "llacct" });
    el.btn = h("button", { "class": "main", type: "button", "aria-haspopup": "true" });
    el.pop = h("div", { "class": "llpop", hidden: "" });
    el.root.append(el.btn, el.pop);
    var host = document.querySelector(".r1") || document.querySelector("header .nav") || document.querySelector("header");
    if (host && host.classList.contains("nav")) { el.root.classList.add("site"); var mn = host.querySelector(".menu"); if (mn) mn.before(el.root); else host.append(el.root); } else if (host) { var grow = host.querySelector(".grow"); (grow && grow.parentNode === host ? grow.after(el.root) : host.append(el.root)); } else { el.root.classList.add("fixed"); document.body.append(el.root); }
    el.btn.onclick = function (e) { e.stopPropagation(); el.pop.hidden = !el.pop.hidden; if (!el.pop.hidden) renderPop(); };
    document.addEventListener("click", function (e) { if (!el.root.contains(e.target)) el.pop.hidden = true; });
    render();
  }

  // ---------------------------------------------------------------- Google sign-in and Drive appData sync
  var gisLoaded;
  function loadGis() {
    if (gisLoaded) return gisLoaded;
    gisLoaded = new Promise(function (res, rej) { var s = h("script", { src: "https://accounts.google.com/gsi/client", async: "" }); s.onload = res; s.onerror = function () { rej(new Error("Could not load Google sign-in")); }; document.head.append(s); });
    return gisLoaded;
  }
  var tc;
  function signIn() {
    st.state = "busy"; render();
    loadGis().then(function () {
      tc = tc || google.accounts.oauth2.initTokenClient({
        client_id: CLIENT, scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
        callback: function (r) {
          if (r.error) { st.state = st.email ? "expired" : "out"; render(); toast("Sign-in cancelled"); return; }
          st.token = r.access_token;
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + st.token } }).then(function (x) { return x.json(); }).then(function (u) {
            st.email = u.email || st.email; st.name = u.name || ""; try { rawSet.call(ls, "ll:acct", JSON.stringify({ email: st.email, name: st.name })); } catch (e) { /* ignore */ }
            hideGate(); pull(false);
          }).catch(function () { hideGate(); pull(false); });
        },
        error_callback: function () { st.state = st.email ? "expired" : "out"; render(); },
      });
      tc.requestAccessToken({ prompt: st.email ? "" : "select_account", login_hint: st.email || undefined });
    }).catch(function (e) { st.state = "error"; st.err = e.message; render(); });
  }
  function signOut() {
    try { if (st.token && window.google) google.accounts.oauth2.revoke(st.token, function () {}); } catch (e) { /* ignore */ }
    st = { state: "out", email: "", name: "", token: "", pushT: 0, last: "", fileId: "" }; try { rawRemove.call(ls, "ll:acct"); } catch (e) { /* ignore */ }
    el.pop.hidden = true; render(); if (GATED) showGate(); else toast("Signed out");
  }
  function api(url, opt) {
    opt = opt || {}; opt.headers = Object.assign({ Authorization: "Bearer " + st.token }, opt.headers || {});
    return fetch(url, opt).then(function (r) { if (r.status === 401) { st.state = "expired"; st.token = ""; render(); throw new Error("session expired"); } if (!r.ok) throw new Error("Drive error " + r.status); return r; });
  }
  var NAME = "learnerslab-projects.json";
  function findFile() {
    if (st.fileId) return Promise.resolve(st.fileId);
    return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=" + encodeURIComponent("name='" + NAME + "'")).then(function (r) { return r.json(); }).then(function (j) { st.fileId = j.files && j.files[0] ? j.files[0].id : ""; return st.fileId; });
  }
  function localItems() { var m = meta(), o = {}; managedKeys().forEach(function (k) { if (SYNCED.test(k)) o[k] = { t: m[k] || 0, v: ls.getItem(k) }; }); return o; }
  function done(msg) { st.state = "ready"; st.err = ""; st.last = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); render(); if (msg) toast(msg); }
  function fail(e) { if (st.state !== "expired") { st.state = "error"; st.err = e.message; } render(); }
  function pull(manual) {
    st.state = "busy"; render();
    findFile().then(function (id) { return id ? api("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media").then(function (r) { return r.json(); }) : { items: {} }; }).then(function (remote) {
      var local = localItems(), newer = [], m = meta();
      Object.keys(remote.items || {}).forEach(function (k) {
        if (!SYNCED.test(k)) return;
        var r = remote.items[k], l = local[k];
        if (!l || (r.t || 0) > l.t) { if (!l || l.v !== r.v) newer.push(k); try { rawSet.call(ls, k, r.v); m[k] = r.t || Date.now(); } catch (e) { /* too big */ } }
      });
      saveMeta(m);
      return push().then(function () {
        done(manual ? "Synced with Google Drive" : "Signed in");
        if (newer.length) toast("Newer work found in your Drive", "Reload", function () { location.reload(); });
      });
    }).catch(fail);
  }
  function push() {
    return findFile().then(function (id) {
      var body = JSON.stringify({ v: 1, app: "learnerslab", saved: Date.now(), items: localItems() });
      if (id) return api("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body });
      var b = "ll" + Math.random().toString(36).slice(2);
      var multi = "--" + b + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify({ name: NAME, parents: ["appDataFolder"] }) + "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + b + "--";
      return api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: multi }).then(function (r) { return r.json(); }).then(function (j) { st.fileId = j.id; });
    });
  }
  function schedulePush() {
    if (st.state !== "ready" || !st.token) return;
    clearTimeout(st.pushT);
    st.pushT = setTimeout(function () { push().then(function () { done(); }).catch(fail); }, 5000);
  }
  window.addEventListener("pagehide", function () { if (st.state === "ready" && st.token && st.pushT) { try { push(); } catch (e) { /* best effort */ } } });

  window.LLAccount = { used: used, limit: LIMIT, signIn: signIn, signOut: signOut, sync: function () { return pull(true); } };
  var GATED = !!CLIENT && CFG.requireSignIn !== false && !window.LL_NOGATE;
  function start() { if (CLIENT) { mount(); if (GATED && st.state === "out") showGate(); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
