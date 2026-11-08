(function () {
  "use strict";

  var CATS = window.CATEGORIES || [];
  var STYLES = (window.STYLES || []).slice();
  var catOrder = {};
  CATS.forEach(function (c, i) { catOrder[c.code] = i; });
  // stable sort by category, keep in-file order
  STYLES = STYLES.map(function (s, i) { return { s: s, i: i }; })
    .sort(function (a, b) { return (catOrder[a.s.cat] - catOrder[b.s.cat]) || (a.i - b.i); })
    .map(function (x, n) { x.s.no = n + 1; return x.s; });
  var byId = {};
  STYLES.forEach(function (s) { byId[s.id] = s; });
  var catByCode = {};
  CATS.forEach(function (c) { catByCode[c.code] = c; });

  var STATUS = [
    { v: "todo",   zh: "待找參考圖", en: "To source",   cls: "s-todo",   color: "var(--ink-3)" },
    { v: "review", zh: "待審查",     en: "In review",   cls: "s-review", color: "var(--warn)" },
    { v: "ok",     zh: "參考已確認", en: "Approved",    cls: "s-ok",     color: "var(--info)" },
    { v: "gen",    zh: "已生成",     en: "Generated",   cls: "s-gen",    color: "var(--ok)" },
    { v: "redo",   zh: "需修改",     en: "Needs redo",  cls: "s-redo",   color: "var(--accent)" }
  ];
  var statusBy = {};
  STATUS.forEach(function (s) { statusBy[s.v] = s; });

  var STEPS = [
    ["定位", "畫面風格書"], ["選題", "100 個風格"], ["撰文", "歷史・背景・用途"], ["雙語", "中英對照"],
    ["清單", "風格總表"], ["蒐圖", "Pinterest 6 張"], ["審查", "提供確認"], ["送生成", "ChatGPT Image"],
    ["生成", "系列 6 張"], ["網站", "暫時 HTML"]
  ];

  // ---------- storage ----------
  var KEY = "stylebook.v1";
  var state = { styles: {}, subjects: null, lang: "both", view: "grid", theme: null };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) { var p = JSON.parse(raw); if (p && typeof p === "object") state = Object.assign(state, p); }
  } catch (e) { /* storage unavailable */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function rec(id) {
    if (!state.styles[id]) state.styles[id] = { status: "todo", notes: "", refs: [], gen: [] };
    var r = state.styles[id];
    for (var i = 0; i < 6; i++) {
      if (!r.refs[i]) r.refs[i] = { img: "", link: "", pick: false };
      if (r.gen[i] == null) r.gen[i] = "";
    }
    return r;
  }
  function peek(id) { return state.styles[id] || { status: "todo", refs: [], gen: [] }; }
  function subjects() { return state.subjects || window.DEFAULT_SUBJECTS; }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^(https?:)?\/\//i.test(u) || /^images\//.test(u) || /^data:image\//i.test(u)) return u;
    return "";
  }
  function pad(n) { return ("00" + n).slice(-3); }
  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }
  function copy(text) {
    var done = function () { toast("已複製 Copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta);
  }
  function pinUrl(s) { return "https://www.pinterest.com/search/pins/?q=" + encodeURIComponent(s.pin || s.en); }
  function badge(v) { var s = statusBy[v] || statusBy.todo; return '<span class="badge ' + s.cls + '">' + s.zh + "</span>"; }

  // ---------- prompts ----------
  function buildPrompt(s, n) {
    var subj = subjects()[n];
    var subjEn = n === 5 ? subj.en + ' — headline text "' + s.en.toUpperCase() + '", small subtitle "' + s.zh + '"' : subj.en;
    var en =
      "Create image " + (n + 1) + " of a 6-image series illustrating the visual style \"" + s.en + "\".\n" +
      "Subject: " + subjEn + ".\n" +
      "Style: " + s.en + " (" + (s.era && s.era.en ? s.era.en : "") + "). " + (s.keywords || []).join(", ") + ".\n" +
      "Key traits: " + ((s.traits && s.traits.en) || []).join("; ") + ".\n" +
      "Color palette: " + (s.palette || []).join(", ") + ".\n" +
      "Format: vertical 3:4 book plate, centered composition, clean background margin.\n" +
      "Series consistency: keep the same palette, lighting, line quality and rendering technique across all 6 images.\n" +
      "Avoid: watermarks, signatures, logos, extra text" + (n === 5 ? " beyond the headline and subtitle" : "") + ".";
    var zh =
      "【第 " + (n + 1) + "／6 張】以「" + s.zh + "」風格呈現：" + subj.zh +
      "。特徵：" + ((s.traits && s.traits.zh) || []).join("、") + "。色彩：" + (s.palette || []).join("、") +
      "。直式 3:4，六張保持一致的配色、光線與筆觸，不要浮水印與簽名。";
    return { en: en, zh: zh };
  }
  function allPrompts(s) {
    var out = [];
    for (var i = 0; i < 6; i++) out.push(buildPrompt(s, i).en);
    return "Please generate the following 6 images one by one as a consistent series.\n\n" +
      out.map(function (p, i) { return "--- Image " + (i + 1) + " ---\n" + p; }).join("\n\n");
  }

  // ---------- header ----------
  function renderSteps() {
    $("steps").innerHTML = STEPS.map(function (s, i) {
      var cls = i < 5 || i === 9 ? "done" : i === 5 || i === 6 ? "now" : "tool";
      return '<div class="step ' + cls + '"><b>' + (i + 1) + "</b>" + s[0] + "<br>" + s[1] + "</div>";
    }).join("");
  }
  function renderMeter() {
    var counts = {}; STATUS.forEach(function (s) { counts[s.v] = 0; });
    STYLES.forEach(function (s) { counts[peek(s.id).status || "todo"]++; });
    var total = STYLES.length || 1;
    var bar = '<div class="bar">' + STATUS.map(function (s) {
      return '<i style="width:' + (counts[s.v] / total * 100) + "%;background:" + s.color + '"></i>';
    }).join("") + "</div>";
    var legend = STATUS.map(function (s) {
      return '<span><i class="dot" style="background:' + s.color + '"></i>' + s.zh + " " + counts[s.v] + "</span>";
    }).join("");
    $("meter").innerHTML = "<span><b>" + STYLES.length + "</b> 個風格</span>" + bar + legend;
  }

  // ---------- toolbar ----------
  var filt = { cat: "all", q: "", status: "all" };
  function renderChips() {
    var html = '<button class="chip' + (filt.cat === "all" ? " on" : "") + '" data-cat="all">全部 All<em>' + STYLES.length + "</em></button>";
    CATS.forEach(function (c) {
      var n = STYLES.filter(function (s) { return s.cat === c.code; }).length;
      html += '<button class="chip' + (filt.cat === c.code ? " on" : "") + '" data-cat="' + c.code + '">' +
        c.code + " " + c.zh + "<em>" + n + "</em></button>";
    });
    $("chips").innerHTML = html;
  }
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    filt.cat = b.dataset.cat; renderChips(); renderMain();
  });
  $("fStatus").innerHTML = '<option value="all">所有狀態</option>' +
    STATUS.map(function (s) { return '<option value="' + s.v + '">' + s.zh + " · " + s.en + "</option>"; }).join("");
  $("fStatus").addEventListener("change", function () { filt.status = this.value; renderMain(); });
  $("q").addEventListener("input", function () { filt.q = this.value.trim().toLowerCase(); renderMain(); });

  function seg(id, key, after) {
    var el = $(id);
    function paint() { Array.prototype.forEach.call(el.children, function (b) { b.classList.toggle("on", b.dataset.v === state[key]); }); }
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state[key] = b.dataset.v; save(); paint(); after();
    });
    paint();
  }
  seg("lang", "lang", function () { renderMain(); if (current) openStyle(current, true); });
  seg("view", "view", renderMain);

  function applyTheme() {
    if (state.theme) document.documentElement.setAttribute("data-theme", state.theme);
    else document.documentElement.removeAttribute("data-theme");
  }
  $("btnTheme").addEventListener("click", function () {
    var dark = state.theme ? state.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    state.theme = dark ? "light" : "dark"; save(); applyTheme();
  });
  applyTheme();

  // ---------- main list ----------
  function matches(s) {
    if (filt.cat !== "all" && s.cat !== filt.cat) return false;
    if (filt.status !== "all" && (peek(s.id).status || "todo") !== filt.status) return false;
    if (filt.q) {
      var hay = [s.zh, s.en, s.id, s.era && s.era.zh, s.era && s.era.en, (s.keywords || []).join(" "), s.icons && s.icons.zh, s.icons && s.icons.en].join(" ").toLowerCase();
      if (hay.indexOf(filt.q) < 0) return false;
    }
    return true;
  }
  function cardTop(s) {
    var r = peek(s.id);
    var imgs = (r.gen || []).map(safeUrl).filter(Boolean);
    if (!imgs.length) imgs = (r.refs || []).filter(function (x) { return x && x.pick; }).map(function (x) { return safeUrl(x.img); }).filter(Boolean);
    if (imgs.length >= 3) {
      return '<div class="thumbs">' + imgs.slice(0, 3).map(function (u) { return '<img loading="lazy" alt="" src="' + esc(u) + '">'; }).join("") + "</div>";
    }
    return '<div class="sw">' + (s.palette || []).map(function (c) { return '<i style="background:' + esc(c) + '"></i>'; }).join("") + "</div>";
  }
  function renderMain() {
    renderMeter();
    var list = STYLES.filter(matches);
    var m = $("main");
    if (!STYLES.length) { m.innerHTML = '<div class="empty">資料載入中或尚未建立 data/part*.js</div>'; return; }
    if (!list.length) { m.innerHTML = '<div class="empty">沒有符合的風格 · No matching styles</div>'; return; }
    if (state.view === "table") {
      m.innerHTML = '<div class="tablewrap"><table><thead><tr><th>#</th><th>中文名稱</th><th>English</th><th>分類</th><th>年代／地區</th><th>色票</th><th>參考圖</th><th>已選</th><th>生成</th><th>狀態</th></tr></thead><tbody>' +
        list.map(function (s) {
          var r = peek(s.id), c = catByCode[s.cat] || {};
          var refs = (r.refs || []).filter(function (x) { return x && x.img; }).length;
          var picks = (r.refs || []).filter(function (x) { return x && x.pick; }).length;
          var gens = (r.gen || []).filter(Boolean).length;
          return '<tr data-id="' + esc(s.id) + '"><td>' + pad(s.no) + "</td><td><b>" + esc(s.zh) + "</b></td><td><i>" + esc(s.en) + "</i></td><td>" +
            esc(s.cat + " " + (c.zh || "")) + "</td><td>" + esc(s.era && s.era.zh) + '</td><td><div class="mini">' +
            (s.palette || []).map(function (h) { return '<i style="background:' + esc(h) + '"></i>'; }).join("") +
            "</div></td><td>" + refs + "/6</td><td>" + picks + "/6</td><td>" + gens + "/6</td><td>" + badge(r.status || "todo") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      return;
    }
    var html = "";
    CATS.forEach(function (c) {
      var items = list.filter(function (s) { return s.cat === c.code; });
      if (!items.length) return;
      html += '<div class="section-title"><div class="code">' + c.code + "</div><h2>" + esc(c.zh) + "<span>" + esc(c.en) + "</span></h2></div>";
      html += '<div class="grid">' + items.map(function (s) {
        var r = peek(s.id);
        var ec = state.lang === "zh" ? "" : '<div class="en">' + esc(s.en) + "</div>";
        var zc = state.lang === "en" ? "" : '<div class="zh">' + esc(s.zh) + "</div>";
        var era = state.lang === "en" ? s.era && s.era.en : s.era && s.era.zh;
        var picks = (r.refs || []).filter(function (x) { return x && x.pick; }).length;
        return '<button class="card" data-id="' + esc(s.id) + '">' + cardTop(s) + '<div class="body"><div class="no">No. ' + pad(s.no) + "</div>" + zc + ec +
          '<div class="era">' + esc(era) + '</div><div class="foot"><span>參考 ' + picks + "/6</span>" + badge(r.status || "todo") + "</div></div></button>";
      }).join("") + "</div>";
    });
    m.innerHTML = html;
  }
  $("main").addEventListener("click", function (e) {
    var el = e.target.closest("[data-id]"); if (!el) return;
    location.hash = "#/style/" + el.dataset.id;
  });

  // ---------- detail ----------
  var current = null;
  function biBlock(zh, en, extra) {
    var cls = (state.lang === "zh" ? " hide-en" : state.lang === "en" ? " hide-zh" : "") + (extra ? " " + extra : "");
    return '<div class="bi' + cls + '"><div class="zh">' + esc(zh) + '</div><div class="en">' + esc(en) + "</div></div>";
  }
  function openStyle(id, keepScroll) {
    var s = byId[id]; if (!s) return;
    current = id;
    var r = rec(id);
    var c = catByCode[s.cat] || {};
    var idx = STYLES.indexOf(s);
    var traitsZh = (s.traits && s.traits.zh) || [], traitsEn = (s.traits && s.traits.en) || [];
    var showZh = state.lang !== "en", showEn = state.lang !== "zh";

    var traits = traitsZh.map(function (t, i) {
      return "<li>" + (showZh ? esc(t) : "") + (showEn ? (showZh ? "<small>" : "") + esc(traitsEn[i] || "") + (showZh ? "</small>" : "") : "") + "</li>";
    }).join("");

    var refSlots = r.refs.map(function (x, i) {
      var src = safeUrl(x.img) || ("images/reference/" + s.id + "-" + (i + 1) + ".jpg");
      return '<div class="slot' + (x.pick ? " pick" : "") + '" data-i="' + i + '">' +
        '<div class="ph">' + (i + 1) + '<img alt="" loading="lazy" src="' + esc(src) + '" onerror="this.remove()"></div>' +
        '<div class="ctl"><input type="url" data-k="img" placeholder="圖片網址 Image URL" value="' + esc(x.img) + '">' +
        '<input type="url" data-k="link" placeholder="Pin 連結 Pin link" value="' + esc(x.link) + '">' +
        '<div class="row"><label><input type="checkbox" data-k="pick"' + (x.pick ? " checked" : "") + "> 選定</label>" +
        (safeUrl(x.link) ? '<a href="' + esc(safeUrl(x.link)) + '" target="_blank" rel="noopener">開啟 ↗</a>' : "") + "</div></div></div>";
    }).join("");

    var genSlots = r.gen.map(function (u, i) {
      var src = safeUrl(u) || ("images/generated/" + s.id + "-" + (i + 1) + ".png");
      return '<div class="slot" data-g="' + i + '"><div class="ph">' + (i + 1) +
        '<img alt="" loading="lazy" src="' + esc(src) + '" onerror="this.remove()"></div>' +
        '<div class="ctl"><input type="url" data-k="gen" placeholder="生成圖網址 URL" value="' + esc(u) + '">' +
        '<div class="row" style="font-size:11px;color:var(--ink-3)">' + esc(subjects()[i].zh.split("：")[0]) + "</div></div></div>";
    }).join("");

    var prompts = [0, 1, 2, 3, 4, 5].map(function (i) {
      var p = buildPrompt(s, i);
      return '<div class="prompt"><div class="t"><span>' + (i + 1) + "．" + esc(subjects()[i].zh.split("：")[0]) +
        '</span><button class="btn" data-copy="' + i + '">複製</button></div><pre>' + esc(p.en) + "</pre>" +
        (showZh ? '<div class="zhp">' + esc(p.zh) + "</div>" : "") + "</div>";
    }).join("");

    $("sheet").innerHTML =
      '<div class="sheet-head"><div class="palette">' + (s.palette || []).map(function (h) { return '<i style="background:' + esc(h) + '"></i>'; }).join("") + "</div>" +
      '<div class="no">No. ' + pad(s.no) + " · " + esc(s.cat) + " " + esc(c.zh) + " / " + esc(c.en) + "</div>" +
      "<h2>" + (showZh ? esc(s.zh) : "") + (showEn ? "<em>" + esc(s.en) + "</em>" : "") + "</h2>" +
      '<div class="era">' + (showZh ? esc(s.era && s.era.zh) : "") + (showZh && showEn ? "　|　" : "") + (showEn ? esc(s.era && s.era.en) : "") + "</div>" +
      '<div class="sheet-nav"><button data-nav="-1" aria-label="上一個">‹</button><button data-nav="1" aria-label="下一個">›</button><button data-nav="0" aria-label="關閉">×</button></div></div>' +
      '<div class="sheet-body">' +
        '<div class="block"><h3>風格簡介 <span>Introduction</span></h3>' + biBlock(s.intro && s.intro.zh, s.intro && s.intro.en) + "</div>" +
        '<div class="block"><h3>使用情境 <span>When to Use</span></h3>' + biBlock(s.usage && s.usage.zh, s.usage && s.usage.en) + "</div>" +
        '<div class="block"><div class="facts">' +
          '<div><div class="lab">視覺特徵 · Traits</div><ul>' + traits + "</ul></div>" +
          '<div><div class="lab">常見場域 · Where It Appears</div>' + biBlock(s.seen && s.seen.zh, s.seen && s.seen.en, "stack") + "</div>" +
          '<div><div class="lab">代表人物／作品 · Icons</div>' + biBlock(s.icons && s.icons.zh, s.icons && s.icons.en, "stack") + "</div>" +
        "</div></div>" +
        '<div class="block"><h3>代表色票 <span>Palette & Keywords</span></h3><div class="swatches">' +
          (s.palette || []).map(function (h) { return "<div><i style=\"background:" + esc(h) + '"></i>' + esc(h) + "</div>"; }).join("") +
        '</div><div class="kw" style="margin-top:14px">' + (s.keywords || []).map(function (k) { return "<span>" + esc(k) + "</span>"; }).join("") + "</div></div>" +
        '<div class="block"><h3>Pinterest 參考圖 <span>6 References</span><span class="act"><a class="btn primary" href="' + esc(pinUrl(s)) +
          '" target="_blank" rel="noopener">在 Pinterest 搜尋 ↗</a><button class="btn" data-copy="pin">複製搜尋詞</button></span></h3>' +
          '<div class="slots" id="refSlots">' + refSlots + "</div>" +
          '<p class="hint">搜尋詞：<b>' + esc(s.pin) + "</b>。在 Pinterest 對圖片按右鍵「複製圖片位址」貼到上方，或將檔案放在 <code>images/reference/" + esc(s.id) + "-1.jpg</code>～<code>-6.jpg</code>。勾選「選定」標記要送去生成的代表圖。</p></div>" +
        '<div class="block"><h3>審查 <span>Review</span></h3><div class="review"><div><div class="lab">狀態 Status</div><select class="sel" id="rStatus" style="width:100%">' +
          STATUS.map(function (x) { return '<option value="' + x.v + '"' + (r.status === x.v ? " selected" : "") + ">" + x.zh + " · " + x.en + "</option>"; }).join("") +
          '</select></div><div><div class="lab">審查備註 Notes</div><textarea id="rNotes" placeholder="例如：第 3 張太偏插畫、需要更多建築案例…">' + esc(r.notes) + "</textarea></div></div></div>" +
        '<div class="block"><h3>ChatGPT 生圖提示詞 <span>6-Image Series Prompts</span><span class="act"><button class="btn primary" data-copy="all">複製全部 6 則</button></span></h3>' +
          '<div class="prompts">' + prompts + '</div><p class="hint">建議做法：在 ChatGPT 先上傳上方選定的 6 張參考圖，再貼上「複製全部 6 則」，請它依序產生。主題可在工具列「系列主題設定」統一修改。</p></div>' +
        '<div class="block"><h3>AI 生成結果 <span>Generated Series</span></h3><div class="slots" id="genSlots">' + genSlots + "</div>" +
          '<p class="hint">把生成圖存為 <code>images/generated/' + esc(s.id) + "-1.png</code>～<code>-6.png</code> 會自動顯示，或貼上圖片網址。</p></div>" +
      "</div>";

    var ov = $("overlay");
    if (!ov.classList.contains("open")) { ov.classList.add("open"); document.body.style.overflow = "hidden"; }
    if (!keepScroll) ov.scrollTop = 0;
    $("sheet").dataset.idx = idx;
  }
  function closeStyle() {
    current = null;
    $("overlay").classList.remove("open"); document.body.style.overflow = "";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    renderMain();
  }

  $("sheet").addEventListener("click", function (e) {
    var nav = e.target.closest("[data-nav]");
    if (nav) {
      var d = +nav.dataset.nav;
      if (!d) { closeStyle(); return; }
      var i = (STYLES.indexOf(byId[current]) + d + STYLES.length) % STYLES.length;
      location.hash = "#/style/" + STYLES[i].id; return;
    }
    var cp = e.target.closest("[data-copy]");
    if (cp) {
      var s = byId[current], k = cp.dataset.copy;
      if (k === "all") copy(allPrompts(s));
      else if (k === "pin") copy(s.pin);
      else copy(buildPrompt(s, +k).en);
    }
  });
  $("sheet").addEventListener("change", function (e) {
    if (!current) return;
    var r = rec(current), t = e.target;
    var slot = t.closest(".slot");
    if (t.id === "rStatus") { r.status = t.value; save(); renderMeter(); return; }
    if (t.id === "rNotes") { r.notes = t.value; save(); return; }
    if (slot && slot.dataset.i != null) {
      var x = r.refs[+slot.dataset.i];
      if (t.dataset.k === "pick") {
        x.pick = t.checked;
        var picks = r.refs.filter(function (y) { return y.pick; }).length;
        if (picks > 6) { /* impossible but safe */ }
        if (r.status === "todo" && r.refs.some(function (y) { return y.img; })) r.status = "review";
      } else { x[t.dataset.k] = t.value.trim(); if (r.status === "todo" && x.img) r.status = "review"; }
      save(); openStyle(current, true); return;
    }
    if (slot && slot.dataset.g != null) {
      r.gen[+slot.dataset.g] = t.value.trim();
      if (r.gen.filter(Boolean).length === 6) r.status = "gen";
      save(); openStyle(current, true);
    }
  });
  $("overlay").addEventListener("click", function (e) { if (e.target.id === "overlay") closeStyle(); });
  $("closeX").addEventListener("click", closeStyle);
  document.addEventListener("keydown", function (e) {
    if (!current || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === "Escape") closeStyle();
    if (e.key === "ArrowRight") $("sheet").querySelector('[data-nav="1"]').click();
    if (e.key === "ArrowLeft") $("sheet").querySelector('[data-nav="-1"]').click();
  });

  function route() {
    var m = location.hash.match(/^#\/style\/([\w-]+)/);
    if (m && byId[m[1]]) openStyle(m[1]);
    else if (current) closeStyle();
  }
  window.addEventListener("hashchange", route);

  // ---------- subjects dialog ----------
  function renderSubj(list) {
    $("subjList").innerHTML = list.map(function (s, i) {
      return '<div class="subj"><b>' + (i + 1) + '</b><input data-i="' + i + '" data-k="zh" value="' + esc(s.zh) + '"><input data-i="' + i + '" data-k="en" value="' + esc(s.en) + '"></div>';
    }).join("");
  }
  $("btnSubjects").addEventListener("click", function () { renderSubj(subjects()); $("dlgSubjects").showModal(); });
  $("subjReset").addEventListener("click", function () { renderSubj(window.DEFAULT_SUBJECTS); });
  $("subjSave").addEventListener("click", function () {
    var list = JSON.parse(JSON.stringify(window.DEFAULT_SUBJECTS));
    Array.prototype.forEach.call($("subjList").querySelectorAll("input"), function (inp) { list[+inp.dataset.i][inp.dataset.k] = inp.value.trim() || list[+inp.dataset.i][inp.dataset.k]; });
    state.subjects = list; save(); $("dlgSubjects").close(); toast("已更新系列主題");
    if (current) openStyle(current, true);
  });

  // ---------- export / import ----------
  $("btnExport").addEventListener("click", function () {
    var out = {
      exportedAt: new Date().toISOString(),
      subjects: subjects(),
      styles: STYLES.map(function (s) {
        var r = peek(s.id);
        return {
          no: s.no, id: s.id, zh: s.zh, en: s.en, status: r.status || "todo", notes: r.notes || "",
          references: (r.refs || []).filter(function (x) { return x && (x.img || x.link); }),
          generated: (r.gen || []).filter(Boolean)
        };
      })
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "stylebook-review-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $("fileImport").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (d.subjects) state.subjects = d.subjects;
        (d.styles || []).forEach(function (x) {
          if (!byId[x.id]) return;
          var r = rec(x.id);
          r.status = x.status || r.status; r.notes = x.notes || "";
          (x.references || []).slice(0, 6).forEach(function (ref, i) { r.refs[i] = { img: ref.img || "", link: ref.link || "", pick: !!ref.pick }; });
          (x.generated || []).slice(0, 6).forEach(function (u, i) { r.gen[i] = u; });
        });
        save(); renderMain(); toast("已匯入審查資料");
      } catch (e) { toast("匯入失敗：檔案格式不正確"); }
    };
    rd.readAsText(f); this.value = "";
  });

  // ---------- boot ----------
  renderSteps(); renderChips(); renderMain(); route();
})();
