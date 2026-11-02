// YouTube Loop & Slow — content script.
// YouTube enforces Trusted Types, so the UI is built with createElement only (no innerHTML).
(() => {
  'use strict';
  if (window.__ytLoopSlow) return;
  window.__ytLoopSlow = true;

  const RATE_MIN = 0.25;
  const RATE_MAX = 2;
  const RATE_STEP = 0.05;
  const PRESETS = [0.5, 0.6, 0.75, 0.9, 1];
  const NUDGE = 0.05;        // seconds per nudge click
  const NUDGE_BIG = 1;       // seconds per Shift+click
  const END_PREVIEW = 1.5;   // after moving B, replay this many seconds before it

  const prefs = { preservePitch: true, gap: 0, collapsed: false, hidden: false, pos: null };
  const loop = { a: null, b: null, on: false };
  let video = null;
  let videoId = null;
  let gapTimer = null;
  let marker = null;
  let host = null;
  const ui = {};

  // ---------- helpers ----------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = (v) => Math.round(v * 100) / 100;

  function fmt(t) {
    if (t == null || !isFinite(t)) return '';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // Accepts "75.3", "1:15.3" or "1:01:15.3".
  function parseTime(str) {
    const parts = str.trim().split(':');
    if (!parts[0]) return null;
    const nums = parts.map(Number);
    if (nums.some((n) => !isFinite(n) || n < 0)) return null;
    return nums.reduce((acc, n) => acc * 60 + n, 0);
  }

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  // chrome.storage throws once the extension is reloaded under an open tab; ignore that.
  async function storageGet(key) {
    try { return (await chrome.storage.local.get(key))[key]; } catch { return undefined; }
  }
  function storageSet(key, value) {
    try { chrome.storage.local.set({ [key]: value }); } catch { /* context invalidated */ }
  }
  const savePrefs = () => storageSet('prefs', prefs);
  const loopsKey = () => `loops:${videoId}`;

  function getVideo() {
    return document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('video.html5-main-video');
  }

  function currentVideoId() {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const m = location.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // ---------- playback ----------

  function setRate(r) {
    if (!video) return;
    video.playbackRate = clamp(round2(r), RATE_MIN, RATE_MAX);
    video.preservesPitch = prefs.preservePitch;
    renderRate();
  }

  function seek(t) {
    if (video) video.currentTime = clamp(t, 0, video.duration || t);
  }

  function cancelGap() {
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = null;
  }

  function restartLoop() {
    if (prefs.gap > 0) {
      video.pause();
      seek(loop.a);
      gapTimer = setTimeout(() => {
        gapTimer = null;
        video.play();
      }, prefs.gap * 1000);
    } else {
      seek(loop.a);
    }
  }

  // Runs every 15 ms. Tabs playing audio are exempt from timer throttling,
  // so this keeps working while the tab is in the background.
  function checkLoop() {
    if (!loop.on || !video || gapTimer || loop.a == null || loop.b == null) return;
    if (video.paused || video.seeking) return;
    if (video.currentTime >= loop.b) restartLoop();
  }

  // ---------- loop actions ----------

  function now() {
    return video ? round2(video.currentTime) : 0;
  }

  function setA(t = now()) {
    loop.a = Math.max(0, t);
    if (loop.b != null && loop.b <= loop.a) loop.b = null;
    if (loop.b == null) loop.on = false;
    render();
  }

  function setB(t = now()) {
    if (loop.a == null) loop.a = 0;
    if (t <= loop.a) return flash(ui.bInput);
    const firstTime = loop.b == null;
    loop.b = t;
    if (firstTime) {
      loop.on = true;
      seek(loop.a);
    }
    render();
  }

  function nudge(which, delta) {
    if (which === 'a') {
      if (loop.a == null) return;
      const max = loop.b != null ? loop.b - 0.05 : Infinity;
      loop.a = round2(clamp(loop.a + delta, 0, max));
      if (loop.on) seek(loop.a);
    } else {
      if (loop.b == null) return;
      loop.b = round2(clamp(loop.b + delta, loop.a + 0.05, video?.duration || Infinity));
      if (loop.on) seek(Math.max(loop.a, loop.b - END_PREVIEW));
    }
    render();
  }

  function toggleLoop(force) {
    if (loop.a == null || loop.b == null) return flash(ui.loopBtn);
    loop.on = force ?? !loop.on;
    cancelGap();
    if (loop.on && video && (video.currentTime < loop.a || video.currentTime >= loop.b)) seek(loop.a);
    render();
  }

  function goToA() {
    if (loop.a == null) return;
    cancelGap();
    seek(loop.a);
    if (video?.paused) video.play();
  }

  function clearLoop() {
    loop.a = loop.b = null;
    loop.on = false;
    cancelGap();
    render();
  }

  // ---------- saved loops ----------

  async function getSaved() {
    return videoId ? (await storageGet(loopsKey())) || [] : [];
  }

  async function saveLoop() {
    if (loop.a == null || loop.b == null) return flash(ui.saveBtn);
    const list = await getSaved();
    const name = ui.nameInput.value.trim() || `Loop ${list.length + 1}`;
    list.push({ name, a: loop.a, b: loop.b });
    list.sort((x, y) => x.a - y.a);
    storageSet(loopsKey(), list);
    ui.nameInput.value = '';
    renderSaved();
  }

  async function deleteSaved(index) {
    const list = await getSaved();
    list.splice(index, 1);
    storageSet(loopsKey(), list);
    renderSaved();
  }

  function loadSaved(item) {
    loop.a = item.a;
    loop.b = item.b;
    loop.on = true;
    cancelGap();
    seek(loop.a);
    if (video?.paused) video.play();
    render();
  }

  // ---------- UI ----------

  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; z-index: 2147483000; width: 290px;
      font: 12px/1.4 Roboto, -apple-system, system-ui, sans-serif;
      color: #eee; background: rgba(24, 24, 27, 0.96);
      border: 1px solid #3f3f46; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45); user-select: none;
    }
    .head {
      display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 12px;
      cursor: move; border-bottom: 1px solid #3f3f46;
    }
    .collapsed .head { border-bottom: none; }
    .title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { color: #a1a1aa; font-variant-numeric: tabular-nums; }
    .status.on { color: #5eead4; }
    .body { padding: 10px 12px 12px; display: grid; gap: 10px; }
    .collapsed .body { display: none; }
    .row { display: flex; align-items: center; gap: 6px; }
    .label { width: 14px; font-weight: 700; color: #5eead4; }
    .section { color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
    button {
      font: inherit; color: #eee; background: #3f3f46; border: 1px solid #52525b;
      border-radius: 6px; padding: 3px 8px; cursor: pointer;
    }
    button:hover { background: #52525b; }
    button.icon { padding: 2px 6px; background: transparent; border-color: transparent; color: #a1a1aa; }
    button.icon:hover { color: #fff; background: #3f3f46; }
    button.active, button.primary.on { background: #0f766e; border-color: #14b8a6; }
    button.sq { width: 26px; padding: 3px 0; }
    button.grow { flex: 1; }
    input {
      font: inherit; color: #eee; background: #18181b; border: 1px solid #52525b;
      border-radius: 6px; padding: 3px 6px; min-width: 0;
    }
    input:focus { outline: none; border-color: #14b8a6; }
    input.time { width: 78px; text-align: center; font-variant-numeric: tabular-nums; }
    input.name { flex: 1; }
    input.gap { width: 48px; }
    input[type=range] { flex: 1; accent-color: #14b8a6; padding: 0; border: none; background: none; }
    input[type=checkbox] { accent-color: #14b8a6; margin: 0; }
    .rate { width: 42px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
    .presets button { flex: 1; padding: 2px 0; }
    label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .spacer { flex: 1; }
    .saved { display: grid; gap: 4px; max-height: 140px; overflow-y: auto; }
    .saved .item { display: flex; gap: 4px; }
    .saved .item button:first-child { flex: 1; text-align: left; display: flex; justify-content: space-between; gap: 8px; }
    .saved .range { color: #a1a1aa; font-variant-numeric: tabular-nums; }
    .empty { color: #71717a; }
    .keys { color: #71717a; font-size: 11px; }
    kbd {
      font: 10px ui-monospace, monospace; color: #d4d4d8; background: #27272a;
      border: 1px solid #52525b; border-radius: 3px; padding: 0 4px;
    }
    .flash { animation: flash .5s; }
    @keyframes flash { 30% { border-color: #f87171; background: #7f1d1d; } }
  `;

  function nudgeButton(which, sign) {
    return h('button', {
      class: 'sq',
      textContent: sign < 0 ? '‹' : '›',
      title: `${sign < 0 ? 'Earlier' : 'Later'} by ${NUDGE}s (Shift: ${NUDGE_BIG}s)`,
      onclick: (e) => nudge(which, sign * (e.shiftKey ? NUDGE_BIG : NUDGE)),
    });
  }

  function timeInput(which) {
    return h('input', {
      type: 'text',
      class: 'time',
      placeholder: '—',
      title: 'Type a time like 1:23.45',
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onchange: (e) => {
        const t = parseTime(e.target.value);
        if (t == null) return render();
        which === 'a' ? setA(t) : setB(t);
      },
    });
  }

  function buildUI() {
    host = h('div', { id: 'yt-loop-slow' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS));

    ui.status = h('span', { class: 'status' });
    ui.collapseBtn = h('button', {
      class: 'icon', title: 'Collapse',
      onclick: () => { prefs.collapsed = !prefs.collapsed; savePrefs(); render(); },
    });
    const head = h('div', { class: 'head' },
      h('span', { class: 'title', textContent: 'Loop & Slow' }),
      ui.status,
      ui.collapseBtn,
      h('button', { class: 'icon', textContent: '✕', title: 'Hide (toolbar icon or Alt+Shift+L brings it back)', onclick: () => setHidden(true) }),
    );

    ui.rateSlider = h('input', {
      type: 'range', min: RATE_MIN, max: RATE_MAX, step: RATE_STEP,
      oninput: (e) => setRate(Number(e.target.value)),
    });
    ui.rateLabel = h('span', { class: 'rate' });
    ui.presetBtns = PRESETS.map((r) => h('button', {
      textContent: `${Math.round(r * 100)}%`,
      onclick: () => setRate(r),
    }));
    ui.pitch = h('input', {
      type: 'checkbox',
      onchange: (e) => {
        prefs.preservePitch = e.target.checked;
        if (video) video.preservesPitch = prefs.preservePitch;
        savePrefs();
      },
    });

    ui.aInput = timeInput('a');
    ui.bInput = timeInput('b');
    ui.loopBtn = h('button', { class: 'primary grow', onclick: () => toggleLoop() });
    ui.gap = h('input', {
      type: 'number', class: 'gap', min: 0, max: 10, step: 0.5,
      onchange: (e) => {
        prefs.gap = clamp(Number(e.target.value) || 0, 0, 10);
        savePrefs();
        render();
      },
    });

    ui.nameInput = h('input', {
      type: 'text', class: 'name', placeholder: 'Name (e.g. Chorus riff)',
      onkeydown: (e) => { if (e.key === 'Enter') saveLoop(); },
    });
    ui.saveBtn = h('button', { textContent: 'Save', onclick: saveLoop });
    ui.saved = h('div', { class: 'saved' });

    const body = h('div', { class: 'body' },
      h('div', { class: 'section', textContent: 'Speed' }),
      h('div', { class: 'row' },
        h('button', { class: 'sq', textContent: '−', title: 'Slower (−)', onclick: () => setRate(video.playbackRate - RATE_STEP) }),
        ui.rateSlider,
        h('button', { class: 'sq', textContent: '+', title: 'Faster (=)', onclick: () => setRate(video.playbackRate + RATE_STEP) }),
        ui.rateLabel,
      ),
      h('div', { class: 'row presets' }, ui.presetBtns),
      h('label', {}, ui.pitch, 'Keep original pitch'),

      h('div', { class: 'section', textContent: 'Loop' }),
      h('div', { class: 'row' },
        h('span', { class: 'label', textContent: 'A' }),
        h('button', { textContent: 'Set', title: 'Set A to the current time ([)', onclick: () => setA() }),
        h('span', { class: 'spacer' }),
        nudgeButton('a', -1), ui.aInput, nudgeButton('a', 1),
      ),
      h('div', { class: 'row' },
        h('span', { class: 'label', textContent: 'B' }),
        h('button', { textContent: 'Set', title: 'Set B to the current time (])', onclick: () => setB() }),
        h('span', { class: 'spacer' }),
        nudgeButton('b', -1), ui.bInput, nudgeButton('b', 1),
      ),
      h('div', { class: 'row' },
        ui.loopBtn,
        h('button', { textContent: '⏮ A', title: 'Jump to A (;)', onclick: goToA }),
        h('button', { textContent: 'Clear', onclick: clearLoop }),
      ),
      h('label', { title: 'Pause at A before each repeat — time to write down what you heard' },
        'Pause before repeat', ui.gap, 's'),

      h('div', { class: 'section', textContent: 'Saved loops for this video' }),
      h('div', { class: 'row' }, ui.nameInput, ui.saveBtn),
      ui.saved,

      h('div', { class: 'keys' },
        h('kbd', {}, '['), ' A  ', h('kbd', {}, ']'), ' B  ', h('kbd', {}, '\\'), ' loop  ',
        h('kbd', {}, ';'), ' to A  ', h('kbd', {}, '−'), h('kbd', {}, '='), ' speed'),
    );

    ui.panel = h('div', { class: 'panel' }, head, body);
    root.append(ui.panel);
    makeDraggable(head);
    document.documentElement.append(host);
    placePanel();
  }

  function placePanel() {
    const p = ui.panel;
    const w = p.offsetWidth || 290;
    const hgt = p.offsetHeight || 40;
    const pos = prefs.pos || { left: window.innerWidth - w - 24, top: 72 };
    p.style.left = `${clamp(pos.left, 0, Math.max(0, window.innerWidth - w))}px`;
    p.style.top = `${clamp(pos.top, 0, Math.max(0, window.innerHeight - Math.min(hgt, 40)))}px`;
  }

  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const rect = ui.panel.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        prefs.pos = { left: ev.clientX - dx, top: ev.clientY - dy };
        placePanel();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        savePrefs();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    window.addEventListener('resize', placePanel);
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function setHidden(hidden) {
    prefs.hidden = hidden;
    savePrefs();
    render();
  }

  function renderRate() {
    if (!ui.panel) return;
    const r = video ? video.playbackRate : 1;
    ui.rateSlider.value = r;
    ui.rateLabel.textContent = `${Math.round(r * 100)}%`;
    ui.presetBtns.forEach((b, i) => b.classList.toggle('active', Math.abs(PRESETS[i] - r) < 0.001));
    renderStatus();
  }

  function renderStatus() {
    const r = video ? Math.round(video.playbackRate * 100) : 100;
    const hasLoop = loop.a != null && loop.b != null;
    ui.status.textContent = `${r}%${hasLoop ? ` · ${loop.on ? '⟳ ' : ''}${fmt(loop.a)}–${fmt(loop.b)}` : ''}`;
    ui.status.classList.toggle('on', loop.on);
  }

  function render() {
    if (!host) return;
    host.style.display = prefs.hidden || !videoId ? 'none' : '';
    ui.panel.classList.toggle('collapsed', prefs.collapsed);
    ui.collapseBtn.textContent = prefs.collapsed ? '▾' : '▴';
    ui.collapseBtn.title = prefs.collapsed ? 'Expand' : 'Collapse';
    ui.pitch.checked = prefs.preservePitch;
    if (ui.panel.shadowRoot?.activeElement !== ui.gap) ui.gap.value = prefs.gap;
    ui.aInput.value = fmt(loop.a);
    ui.bInput.value = fmt(loop.b);
    ui.loopBtn.textContent = loop.on ? '⟳ Looping' : 'Loop off';
    ui.loopBtn.classList.toggle('on', loop.on);
    ui.loopBtn.title = 'Toggle loop (\\)';
    renderRate();
    renderMarker();
  }

  async function renderSaved() {
    if (!ui.saved) return;
    const list = await getSaved();
    ui.saved.replaceChildren(...(list.length ? list.map((item, i) =>
      h('div', { class: 'item' },
        h('button', { title: 'Load and loop', onclick: () => loadSaved(item) },
          h('span', { textContent: item.name }),
          h('span', { class: 'range', textContent: `${fmt(item.a)}–${fmt(item.b)}` })),
        h('button', { class: 'icon', textContent: '✕', title: 'Delete', onclick: () => deleteSaved(i) }),
      )) : [h('div', { class: 'empty', textContent: 'None yet.' })]));
  }

  // Highlight the A–B range on YouTube's progress bar.
  function ensureMarker() {
    const bar = document.querySelector('#movie_player .ytp-progress-bar');
    if (!bar) return;
    if (!marker) {
      marker = h('div', { id: 'yt-loop-slow-marker' });
      Object.assign(marker.style, {
        position: 'absolute', top: '0', height: '100%', zIndex: '35', pointerEvents: 'none',
        background: 'rgba(45, 212, 191, 0.45)', borderLeft: '2px solid #2dd4bf',
        borderRight: '2px solid #2dd4bf', boxSizing: 'border-box',
      });
    }
    if (marker.parentNode !== bar) bar.append(marker);
    renderMarker();
  }

  function renderMarker() {
    if (!marker) return;
    const d = video?.duration;
    if (!d || !isFinite(d) || loop.a == null) {
      marker.style.display = 'none';
      return;
    }
    const b = loop.b ?? loop.a;
    marker.style.display = 'block';
    marker.style.left = `${(loop.a / d) * 100}%`;
    marker.style.width = `max(4px, ${((b - loop.a) / d) * 100}%)`;
    marker.style.opacity = loop.on ? '1' : '0.5';
  }

  // ---------- page tracking ----------

  function attachVideo() {
    const v = getVideo();
    if (v === video) return;
    if (video) {
      video.removeEventListener('ratechange', renderRate);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('timeupdate', checkLoop);
    }
    video = v;
    if (!video) return;
    video.addEventListener('ratechange', renderRate);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', checkLoop);
    video.preservesPitch = prefs.preservePitch;
    renderRate();
  }

  function onMetadata() {
    video.preservesPitch = prefs.preservePitch;
    renderMarker();
  }

  // Pressing play during the pause-before-repeat skips the wait.
  function onPlay() {
    if (gapTimer) cancelGap();
  }

  function checkPage() {
    attachVideo();
    const id = currentVideoId();
    if (id !== videoId) {
      videoId = id;
      clearLoop();
      renderSaved();
    }
    ensureMarker();
    render();
  }

  // ---------- keyboard ----------

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!videoId || !video) return;
    const target = e.composedPath()[0];
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName)) return;
    const actions = {
      '[': () => setA(),
      ']': () => setB(),
      '\\': () => toggleLoop(),
      ';': goToA,
      '-': () => setRate(video.playbackRate - RATE_STEP),
      '=': () => setRate(video.playbackRate + RATE_STEP),
      '+': () => setRate(video.playbackRate + RATE_STEP),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'toggle-panel') setHidden(!prefs.hidden);
  });

  // ---------- start ----------

  (async () => {
    Object.assign(prefs, (await storageGet('prefs')) || {});
    buildUI();
    checkPage();
    document.addEventListener('yt-navigate-finish', checkPage);
    setInterval(checkPage, 1000);
    setInterval(checkLoop, 15);
  })();
})();
