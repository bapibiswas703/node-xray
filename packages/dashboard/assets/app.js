/* node-xray dashboard client v1.0
 *
 * Vanilla ES2020. No build step, no framework, no dependencies.
 * Connects to `<dashboardPath>/ws` and renders the wire protocol into
 * the same UI surface as the v4.1 mockup.
 *
 * Wire protocol (from @node-xray/types):
 *   { v, t: 'hello',       payload: { config, server } }
 *   { v, t: 'snapshot',    payload: RequestRecord[] }
 *   { v, t: 'request:new', payload: RequestRecord }
 *   { v, t: 'request:update', payload: { id, patch } }
 *   { v, t: 'request:done',   payload: { id, record } }
 *   { v, t: 'loop',        payload: LoopStats }
 *   { v, t: 'error',       payload: { message, code? } }
 *
 * Client-to-server frames (currently none required for v1).
 */

(function () {
  'use strict';

  // ── dashboard path ──────────────────────────────────────────────────
  // The HTML is served at `<path>`, `<path>/`, or `<path>/index.html`,
  // so the configured mount path is derived from the page URL itself —
  // custom paths need no server-side injection. A server may still
  // override via `window.__XRAY_DASHBOARD_PATH__` (PATH_INJECTOR_SCRIPT
  // in @node-xray/dashboard).
  const derivedPath = window.location.pathname.replace(/\/(index\.html)?$/, '');
  const path =
    (typeof window !== 'undefined' && window.__XRAY_DASHBOARD_PATH__) ||
    derivedPath ||
    '/node-xray';
  const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsScheme + '//' + window.location.host + path + '/ws';

  // ── small DOM helpers ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    if (attrs)
      for (const k of Object.keys(attrs)) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'style') node.setAttribute('style', attrs[k]);
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function')
          node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] === true) node.setAttribute(k, '');
        else if (attrs[k] === false || attrs[k] == null) {
          /* skip */
        } else node.setAttribute(k, attrs[k]);
      }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  };
  const empty = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };
  const fmtBytes = (n) => {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };
  const escapeHtml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const fmtDur = (ms) => (ms == null ? 'pending' : ms < 1 ? '<1ms' : Math.round(ms) + 'ms');
  const methodClass = (m) => {
    if (m === 'GET') return 'bg';
    if (m === 'POST') return 'bu';
    if (m === 'PUT' || m === 'PATCH') return 'bp';
    if (m === 'DELETE') return 'bd';
    return 'br';
  };
  const statusText = (rec) => {
    if (rec.status === 0 || rec.status == null) return 'pending';
    if (rec.status >= 200 && rec.status < 300) return rec.status + ' OK';
    if (rec.status >= 300 && rec.status < 400) return rec.status + ' REDIR';
    if (rec.status >= 400 && rec.status < 500) return rec.status + ' ERR';
    if (rec.status >= 500) return rec.status + ' ERR';
    return String(rec.status);
  };
  const statusClass = (rec) => {
    if (rec.status === 0 || rec.status == null) return 's-pend';
    if (rec.status >= 500) return 's-err';
    if (rec.status >= 400) return 's-err';
    if (rec.status >= 200 && rec.status < 300) return 's-ok';
    return 's-pend';
  };
  const KIND_COLORS = {
    db: '#a78bfa',
    http: '#fbbf24',
    fs: '#34d399',
    crypto: '#f87171',
    dns: '#60a5fa',
    other: '#94a3b8',
  };
  const KIND_LABELS = {
    db: 'PostgreSQL',
    http: '3rd-party API',
    fs: 'Filesystem',
    crypto: 'Crypto',
    dns: 'DNS lookup',
    other: 'Other',
  };

  // ── state ──────────────────────────────────────────────────────────
  const state = {
    records: new Map(), // id -> RequestRecord
    selected: null,
    filter: 'all',
    sort: 'time',
    live: true,
    pendingUpdates: new Map(), // id -> patch (flushed on tick)
    loop: { lagMs: 0, p50: 0, p99: 0, max: 0, utilization: 0, phase: 'unknown', sampledAt: 0 },
    server: { node: '', pid: 0, uptime: 0, framework: '', version: '' },
    config: { path, maxRequests: 0, captureRequestBody: false, captureResponseBody: false },
    connected: false,
    backoff: 1000,
  };

  // ── WebSocket ─────────────────────────────────────────────────────
  let socket = null;
  function connect() {
    setStatus('connecting', 'connecting…');
    try {
      socket = new WebSocket(wsUrl);
    } catch (err) {
      setStatus('off', 'ws blocked');
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      state.connected = true;
      state.backoff = 1000;
      setStatus('live', 'connected');
    });
    socket.addEventListener('message', (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleFrame(frame);
    });
    socket.addEventListener('close', () => {
      state.connected = false;
      setStatus('off', 'disconnected');
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    });
  }
  function scheduleReconnect() {
    setTimeout(connect, state.backoff);
    state.backoff = Math.min(state.backoff * 2, 15000);
  }
  function setStatus(kind, label) {
    const pill = $('conn-pill');
    if (!pill) return;
    pill.className =
      'pill ' +
      (kind === 'live'
        ? 'pill-live'
        : kind === 'paused'
          ? 'pill-paused'
          : kind === 'off'
            ? 'pill-err'
            : 'pill-off');
    pill.textContent = '● ' + label;
    const dot = $('live-dot');
    if (dot) {
      dot.style.background =
        kind === 'live'
          ? '#22c55e'
          : kind === 'paused'
            ? '#fbbf24'
            : kind === 'off'
              ? '#f87171'
              : '#64748b';
      dot.style.animation = kind === 'live' ? 'blink 2s ease-in-out infinite' : 'none';
    }
    const host = $('tb-host');
    if (host)
      host.textContent = state.server.framework
        ? state.server.framework + '@' + (state.server.node || 'node') + ':' + state.server.pid
        : 'connecting…';
  }

  // ── wire protocol ─────────────────────────────────────────────────
  function handleFrame(frame) {
    if (!frame || typeof frame !== 'object' || frame.v !== 1) return;
    switch (frame.t) {
      case 'hello': {
        state.config = frame.payload.config || state.config;
        state.server = frame.payload.server || state.server;
        setStatus('live', 'live');
        break;
      }
      case 'snapshot': {
        state.records.clear();
        for (const r of frame.payload || []) state.records.set(r.id, r);
        renderSidebar();
        renderStats();
        break;
      }
      case 'request:new': {
        if (state.live) {
          state.records.set(frame.payload.id, frame.payload);
          renderSidebar();
        }
        break;
      }
      case 'request:update': {
        if (state.live) {
          const cur = state.records.get(frame.payload.id);
          if (cur) {
            state.records.set(frame.payload.id, Object.assign({}, cur, frame.payload.patch));
            if (state.selected === frame.payload.id) renderSelected();
            renderStats();
          }
        }
        break;
      }
      case 'request:done': {
        if (state.live) {
          state.records.set(frame.payload.id, frame.payload.record);
          if (state.selected === frame.payload.id) renderSelected();
          renderSidebar();
          renderStats();
        }
        break;
      }
      case 'loop': {
        state.loop = frame.payload || state.loop;
        renderLoop();
        break;
      }
      case 'error': {
        // Surface to console only; v1 has no global toast.
        // eslint-disable-next-line no-console
        console.error('[xray]', frame.payload && frame.payload.message);
        break;
      }
    }
  }

  // ── sidebar ───────────────────────────────────────────────────────
  function visibleRecords() {
    const all = Array.from(state.records.values());
    const filtered = all.filter((r) => {
      switch (state.filter) {
        case '2xx':
          return r.status >= 200 && r.status < 300;
        case '4xx':
          return r.status >= 400 && r.status < 500;
        case '5xx':
          return r.status >= 500;
        case 'err':
          return r.status >= 400;
        case 'slow':
          return r.durationMs != null && r.durationMs > 50;
        case 'all':
        default:
          return true;
      }
    });
    filtered.sort((a, b) => {
      if (state.sort === 'dur') {
        return (b.durationMs || 0) - (a.durationMs || 0);
      }
      if (state.sort === 'err') {
        const ea = a.status >= 400 ? 1 : 0;
        const eb = b.status >= 400 ? 1 : 0;
        if (eb !== ea) return eb - ea;
      }
      return b.startedAt - a.startedAt;
    });
    return filtered;
  }

  function renderSidebar() {
    const list = $('req-list');
    if (!list) return;
    empty(list);
    const recs = visibleRecords();
    if (recs.length === 0) {
      list.appendChild(
        el(
          'div',
          { class: 'empty-state' },
          el('div', { class: 'empty-state-h' }, 'No requests yet'),
          'Waiting for the next HTTP call…',
        ),
      );
      return;
    }
    for (const r of recs.slice(0, 200)) {
      const item = el(
        'div',
        {
          class: 'rq-item' + (state.selected === r.id ? ' active' : ''),
          onclick: () => selectRecord(r.id),
        },
        el(
          'div',
          { class: 'rq-top' },
          el('span', { class: 'badge ' + methodClass(r.method) }, r.method),
          el('span', { class: 'rq-path', title: r.path }, r.path),
        ),
        el(
          'div',
          { class: 'rq-meta' },
          el('span', null, statusText(r)),
          el('span', null, fmtDur(r.durationMs)),
        ),
      );
      list.appendChild(item);
    }
  }

  // ── stats ─────────────────────────────────────────────────────────
  function renderStats() {
    const recs = Array.from(state.records.values());
    const total = recs.length;
    const ok = recs.filter((r) => r.status >= 200 && r.status < 300).length;
    const err = recs.filter((r) => r.status >= 400).length;
    const done = recs.filter((r) => r.durationMs != null);
    const avg = done.length ? done.reduce((s, r) => s + (r.durationMs || 0), 0) / done.length : 0;
    $('rc').textContent = String(total);
    $('avgms').textContent = done.length ? Math.round(avg) + 'ms' : '—';
    $('st-tot').textContent = String(total);
    $('st-ok').textContent = String(ok);
    $('st-err').textContent = String(err);
    $('st-avg').textContent = done.length ? Math.round(avg) + 'ms' : '—';
    $('st-lag').textContent = (state.loop.lagMs || 0).toFixed(1) + 'ms';
    $('llg').textContent = (state.loop.lagMs || 0).toFixed(1) + 'ms';
    $('st-pool').textContent =
      state.records.values().next().value && state.records.values().next().value.thread
        ? state.records.values().next().value.thread.busy +
          '/' +
          state.records.values().next().value.thread.size
        : '0/0';
    const busy = (() => {
      let maxBusy = 0,
        maxSize = 0;
      for (const r of recs) {
        if (r.thread) {
          maxBusy = Math.max(maxBusy, r.thread.busy);
          maxSize = Math.max(maxSize, r.thread.size);
        }
      }
      return maxSize > 0 ? maxBusy + '/' + maxSize : '0/0';
    })();
    $('st-pool').textContent = busy;
  }

  // ── selected request ──────────────────────────────────────────────
  function selectRecord(id) {
    state.selected = id;
    renderSidebar();
    renderSelected();
  }

  function renderSelected() {
    const rec = state.selected ? state.records.get(state.selected) : null;
    const lbl = $('sel-lbl');
    if (lbl) {
      lbl.textContent = rec
        ? '● ' +
          rec.method +
          ' ' +
          rec.path +
          ' — ' +
          statusText(rec) +
          ' — ' +
          fmtDur(rec.durationMs)
        : '● no request selected';
    }
    if (!rec) {
      [
        'stack-panel',
        'api-panel',
        'thread-viz',
        'waterfall',
        'tl-body',
        'async-grid',
        'req-meta',
        'req-headers',
        'req-json-display',
        'res-meta',
        'res-headers',
        'res-json-display',
        'tq-body',
        'mq-body',
        'thread-sub',
        'thread-lbl',
        'tl-hdr',
        // NOTE: 'loop-box' / 'lp-name' / 'lp-sub' must NOT be in this
        // list. The Event Loop box is process-level telemetry, not
        // per-request state — and `empty('loop-box')` used to strip
        // #loop-ring/#lp-name/#lp-sub out of the DOM, making every
        // subsequent `loop` frame crash renderLoop on a null node.
        'req-size',
        'res-size',
      ].forEach((id) => {
        const n = $(id);
        if (n) empty(n);
      });
      // Muted hints so the un-selected state reads as "waiting", not
      // broken. Cleared by renderRuntime when a request is selected.
      const hint = (id, text) => {
        const n = $(id);
        if (n) n.appendChild(el('div', { class: 'q-empty' }, text));
      };
      hint('stack-panel', 'select a request to inspect');
      hint('tq-body', 'idle');
      hint('mq-body', 'idle');
      hint('waterfall', 'select a request to see its async waterfall');
      hint('async-grid', 'no async operations recorded');
      return;
    }
    renderRuntime(rec);
    renderBodies(rec);
  }

  function renderRuntime(rec) {
    // Call stack
    const stack = $('stack-panel');
    empty(stack);
    const frames =
      rec.stack && rec.stack.length ? rec.stack : (rec.timeline || []).map((t) => t.name);
    if (frames.length === 0) stack.appendChild(el('div', { class: 'q-empty' }, 'no stack'));
    else
      frames.forEach((f, i) => {
        const cls = i === 0 ? 'f0' : i === frames.length - 1 ? 'fg' : 'fn';
        stack.appendChild(el('div', { class: 'frame ' + cls }, f));
      });

    // API chips
    const apis = $('api-panel');
    empty(apis);
    const apisList = [
      'fs.readFile',
      'pg.query',
      'net.connect',
      'dns.lookup',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'http.request',
      'crypto.pbkdf2',
      'zlib.gzip',
      'child_process',
      'worker_threads',
    ];
    const active = new Set();
    for (const op of rec.asyncOps || []) {
      if (op.kind === 'db') active.add('pg.query');
      if (op.kind === 'http') active.add('http.request');
      if (op.kind === 'fs') active.add('fs.readFile');
      if (op.kind === 'dns') active.add('dns.lookup');
      if (op.kind === 'crypto') active.add('crypto.pbkdf2');
    }
    for (const name of apisList) {
      apis.appendChild(el('span', { class: 'chip ' + (active.has(name) ? 'on' : 'off') }, name));
    }

    // Threads
    const tv = $('thread-viz');
    empty(tv);
    const busy = (rec.thread && rec.thread.busy) || 0;
    const size = (rec.thread && rec.thread.size) || 4;
    for (let i = 0; i < size; i++)
      tv.appendChild(el('div', { class: 'thr' + (i < busy ? ' busy' : '') }));
    $('thread-lbl').textContent = busy + '/' + size + ' threads';
    $('thread-sub').textContent = busy + '/' + size + ' libuv threads busy';

    // Queues (macrotask / microtask)
    const macro = $('tq-body');
    empty(macro);
    const macroChips = (rec.asyncOps || []).filter((o) => o.kind === 'other').map((o) => o.label);
    if (macroChips.length === 0) macro.appendChild(el('span', { class: 'q-empty' }, 'empty'));
    else
      macroChips.forEach((c) =>
        macro.appendChild(el('span', { class: 'qchip qmacro' }, '⌚ ' + c)),
      );
    const micro = $('mq-body');
    empty(micro);
    const microChips = (rec.asyncOps || [])
      .filter((o) => o.kind === 'db' || o.kind === 'http')
      .slice(0, 4)
      .map((o) => o.label);
    if (microChips.length === 0) micro.appendChild(el('span', { class: 'q-empty' }, 'empty'));
    else
      microChips.forEach((c) =>
        micro.appendChild(el('span', { class: 'qchip qmicro' }, '⚡ ' + c)),
      );

    // Waterfall
    const wf = $('waterfall');
    empty(wf);
    const ops = rec.asyncOps || [];
    if (ops.length === 0) {
      wf.appendChild(el('div', { class: 'q-empty' }, 'no async ops recorded'));
    } else {
      const max = Math.max(1, ...ops.map((o) => o.startedAt - rec.startedAt + (o.durationMs || 0)));
      for (const op of ops) {
        const start = Math.max(0, ((op.startedAt - rec.startedAt) / max) * 100);
        const dur = Math.max(2, ((op.durationMs || 0) / max) * 100);
        const color = KIND_COLORS[op.kind] || '#94a3b8';
        const row = el(
          'div',
          { class: 'wf-row' },
          el('div', { class: 'wf-lbl' }, op.label || KIND_LABELS[op.kind] || op.kind),
          el(
            'div',
            { class: 'wf-track' },
            el('div', {
              class: 'wf-bar',
              style: 'left:' + start + '%;width:' + dur + '%;background:' + color,
            }),
          ),
          el('div', { class: 'wf-ms' }, op.durationMs != null ? op.durationMs + 'ms' : '—'),
        );
        wf.appendChild(row);
      }
    }

    // Timeline
    $('tl-hdr').textContent = 'request timeline — ' + rec.method + ' ' + rec.path;
    const tlb = $('tl-body');
    empty(tlb);
    for (const e of rec.timeline || []) {
      const row = el(
        'div',
        { class: 'tl-row' },
        el('div', {
          class: 'tl-dot',
          style: 'background:' + (KIND_COLORS[mapKind(e.kind)] || '#a5b4fc'),
        }),
        el(
          'div',
          { class: 'tl-card' },
          el('div', { class: 'tl-name' }, e.name || e.kind),
          el('div', { class: 'tl-meta' }, e.detail || ''),
        ),
        el('div', { class: 'tl-ts' }, (e.at != null ? e.at : 0) + 'ms'),
      );
      tlb.appendChild(row);
    }

    // Async grid
    const ag = $('async-grid');
    empty(ag);
    const labels = ['db', 'http', 'fs', 'dns', 'crypto', 'other'];
    if ((rec.asyncOps || []).length === 0) {
      for (const kind of labels.slice(0, 4)) {
        ag.appendChild(asyncCard(kind, null));
      }
    } else {
      for (const op of rec.asyncOps || []) {
        ag.appendChild(asyncCard(op.kind, op));
      }
    }
  }
  function mapKind(k) {
    if (k === 'io' || k === 'db') return 'db';
    if (k === 'http') return 'http';
    if (k === 'sync' || k === 'render' || k === 'send') return 'other';
    if (k === 'timer') return 'other';
    if (k === 'await') return 'other';
    return 'other';
  }
  function asyncCard(kind, op) {
    const color = KIND_COLORS[kind] || '#94a3b8';
    const name = KIND_LABELS[kind] || kind;
    const status = op ? op.status || 'done' : '—';
    const statusColor = op
      ? op.status === 'error'
        ? '#f87171'
        : op.status === 'pending'
          ? '#fbbf24'
          : '#34d399'
      : '#3d4466';
    const dur = op ? (op.durationMs != null ? op.durationMs + 'ms' : 'pending') : 'not called';
    const dim = !op ? ' dim' : '';
    const pct =
      op && op.durationMs
        ? Math.min(100, Math.round((op.durationMs / Math.max(1, (state.loop.lagMs || 1) * 10)) * 5))
        : 0;
    const query = op
      ? op.label || op.detail || KIND_LABELS[kind] || kind
      : kind === 'db'
        ? 'no DB call'
        : kind === 'http'
          ? 'no outgoing HTTP'
          : kind === 'fs'
            ? 'no file I/O'
            : kind === 'dns'
              ? 'no DNS needed'
              : 'not used';
    return el(
      'div',
      { class: 'async-card' },
      el(
        'div',
        { class: 'async-top' },
        el('span', { class: 'async-name', style: 'color:' + color }, name),
        el('span', { class: 'async-stat', style: 'color:' + statusColor }, status),
      ),
      el('div', { class: 'async-dur' + dim }, dur),
      el('div', { class: 'async-q' }, query),
      el(
        'div',
        { class: 'bar-track' },
        el('div', { class: 'bar-fill', style: 'width:' + pct + '%;background:' + color }),
      ),
    );
  }

  function renderBodies(rec) {
    // Request
    const rmeta = $('req-meta');
    empty(rmeta);
    const rtag = (k, v, cls) => el('span', { class: 'bi-tag ' + (cls || 'bi-tag-k') }, k + ' ' + v);
    rmeta.appendChild(rtag('Method', rec.method, 'bi-tag-k'));
    rmeta.appendChild(rtag('Path', rec.path, 'bi-tag-k'));
    if (rec.route) rmeta.appendChild(rtag('Route', rec.route, 'bi-tag-h'));
    const rbody = rec.request && rec.request.body;
    const rbodyRaw =
      rbody == null ? '' : typeof rbody === 'string' ? rbody : JSON.stringify(rbody, null, 2);
    $('req-json-raw').textContent = rbodyRaw;
    const rdisp = $('req-json-display');
    empty(rdisp);
    if (rbody == null)
      rdisp.appendChild(
        el(
          'div',
          { class: 'no-body' },
          rec.method === 'GET' || rec.method === 'DELETE'
            ? 'No request body'
            : 'No request body captured',
        ),
      );
    else if (typeof rbody === 'string')
      rdisp.appendChild(el('div', { class: 'json-wrap', style: 'color:#c4cde8' }, rbody));
    else rdisp.innerHTML = colorizeJson(rbody);
    $('req-size').textContent = rbodyRaw ? fmtBytes(rbodyRaw.length) : '—';
    const rh = $('req-headers');
    empty(rh);
    const rhrows = renderHeaders(rec.request && rec.request.headers);
    if (rhrows.length === 0) rh.appendChild(el('div', { class: 'no-body' }, 'No headers'));
    else rhrows.forEach((r) => rh.appendChild(r));

    // Response
    const rsmeta = $('res-meta');
    empty(rsmeta);
    rsmeta.appendChild(
      rtag(
        'Status',
        statusText(rec),
        rec.status >= 400
          ? 'bi-tag-e'
          : rec.status >= 200 && rec.status < 300
            ? 'bi-tag-v'
            : 'bi-tag-w',
      ),
    );
    rsmeta.appendChild(rtag('Time', fmtDur(rec.durationMs), 'bi-tag-k'));
    if (rec.framework) rsmeta.appendChild(rtag('Framework', rec.framework, 'bi-tag-h'));
    const sbody = rec.response && rec.response.body;
    const sbodyRaw =
      sbody == null ? '' : typeof sbody === 'string' ? sbody : JSON.stringify(sbody, null, 2);
    $('res-json-raw').textContent = sbodyRaw;
    const sdisp = $('res-json-display');
    empty(sdisp);
    if (rec.status === 0)
      sdisp.appendChild(el('div', { class: 'pending-body' }, 'Waiting for response…'));
    else if (sbody == null) sdisp.appendChild(el('div', { class: 'no-body' }, 'No response body'));
    else if (typeof sbody === 'string')
      sdisp.appendChild(el('div', { class: 'json-wrap', style: 'color:#c4cde8' }, sbody));
    else sdisp.innerHTML = colorizeJson(sbody);
    $('res-size').textContent = sbodyRaw ? fmtBytes(sbodyRaw.length) : '—';
    const sh = $('res-headers');
    empty(sh);
    const shrows = renderHeaders(rec.response && rec.response.headers);
    if (shrows.length === 0)
      sh.appendChild(el('div', { class: 'no-body' }, 'No response headers yet'));
    else shrows.forEach((r) => sh.appendChild(r));
  }
  function renderHeaders(headers) {
    if (!headers) return [];
    return Object.keys(headers).map((k) =>
      el(
        'div',
        { class: 'hdr-row' },
        el('span', { class: 'hdr-k' }, k + ': '),
        el('span', { class: 'hdr-v' }, String(headers[k])),
      ),
    );
  }
  function colorizeJson(value) {
    const json = JSON.stringify(value, null, 2);
    if (json == null) return '';
    return escapeHtml(json)
      .replace(/(&quot;[^&]+?&quot;)(\s*:\s*)/g, '<span class="j-key">$1</span>$2')
      .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span class="j-str">$1</span>')
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="j-num">$1</span>')
      .replace(/:\s*(true|false)/g, ': <span class="j-bool">$1</span>')
      .replace(/:\s*(null)/g, ': <span class="j-null">$1</span>');
  }

  // ── event loop box ────────────────────────────────────────────────
  function renderLoop() {
    const phase = state.loop.phase || 'unknown';
    const phaseColors = {
      poll: '#22d3ee',
      timers: '#fbbf24',
      check: '#34d399',
      close: '#f87171',
      pending: '#a78bfa',
      idle: '#64748b',
    };
    const c = phaseColors[phase] || '#22d3ee';
    // Null-safe: a missing node must never throw — loop frames arrive
    // twice a second and an exception here kills live telemetry.
    const lpName = $('lp-name');
    if (lpName) {
      lpName.textContent = phase;
      lpName.style.color = c;
    }
    const lpSub = $('lp-sub');
    if (lpSub) {
      lpSub.textContent =
        phase === 'poll'
          ? 'I/O wait'
          : phase === 'timers'
            ? 'running timer callbacks'
            : phase === 'check'
              ? 'setImmediate callbacks'
              : phase === 'close'
                ? 'closing handles'
                : phase === 'pending'
                  ? 'I/O callbacks'
                  : phase === 'idle'
                    ? 'idle'
                    : 'awaiting telemetry';
    }
    const ring = $('loop-ring');
    if (ring) {
      ring.style.borderColor = c;
      const ringSpin = ring.querySelector('.ring-spin');
      if (ringSpin) ringSpin.style.color = c;
    }
    const box = $('loop-box');
    if (box) box.style.borderColor = c;
    const stLag = $('st-lag');
    if (stLag) stLag.textContent = (state.loop.lagMs || 0).toFixed(1) + 'ms';
    const llg = $('llg');
    if (llg) llg.textContent = (state.loop.lagMs || 0).toFixed(1) + 'ms';
  }

  // ── controls ──────────────────────────────────────────────────────
  function bindFilterSort() {
    document.querySelectorAll('.filter-bar .fb').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.filter-bar .fb').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        state.filter = b.getAttribute('data-filter');
        renderSidebar();
      });
    });
    document.querySelectorAll('.ml .cb').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.ml .cb').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        state.sort = b.getAttribute('data-sort');
        renderSidebar();
      });
    });
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.getAttribute('data-tab'), t));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') switchTab(t.getAttribute('data-tab'), t);
      });
    });
    $('btn-live').addEventListener('click', toggleLive);
    $('btn-clear').addEventListener('click', () => {
      state.records.clear();
      state.selected = null;
      renderSidebar();
      renderSelected();
      renderStats();
      // Also clear the server-side ring buffer — otherwise a reload
      // replays the old history from the snapshot. The server answers
      // with an empty snapshot broadcast to every connected tab.
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ v: 1, t: 'clear' }));
      }
    });
    document.querySelectorAll('.headers-toggle').forEach((b) => {
      b.addEventListener('click', () => {
        const target = b.getAttribute('data-toggle');
        const node = $(target);
        if (!node) return;
        const hidden = node.style.display === 'none';
        node.style.display = hidden ? 'block' : 'none';
        b.textContent = hidden ? 'hide' : 'show';
      });
    });
    document.querySelectorAll('.copy-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const target = b.getAttribute('data-copy');
        const node = $(target);
        if (!node) return;
        const text = node.textContent || '';
        if (!text) return;
        const original = b.textContent;
        const done = () => {
          b.textContent = 'copied!';
          b.classList.add('copied');
          setTimeout(() => {
            b.textContent = original;
            b.classList.remove('copied');
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else done();
      });
    });
  }
  function switchTab(tab, elx) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
    elx.classList.add('on');
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('on'));
    const target = $('tab-' + tab);
    if (target) target.classList.add('on');
  }
  function toggleLive() {
    state.live = !state.live;
    const btn = $('btn-live');
    btn.textContent = state.live ? '⏸ pause' : '▶ resume';
    btn.classList.toggle('on', state.live);
    setStatus(state.live ? 'live' : 'paused', state.live ? 'live' : 'paused');
    if (state.live) renderSidebar();
  }

  // ── boot ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    bindFilterSort();
    renderSidebar();
    renderSelected();
    renderStats();
    connect();
  });
})();
