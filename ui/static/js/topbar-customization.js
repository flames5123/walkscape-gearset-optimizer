/*
 * Top-bar / side-bar icon customization  (FAC: topbar_customization)
 * ------------------------------------------------------------------
 * Lets a session customize its header: a hamburger drawer lists every icon the
 * session has access to (alphabetical, drag-reorderable); an edit mode lets the
 * user hide icons (checkbox / drag to a removed-icons tray), reorder them and
 * move them between the left and right clusters (iPhone-style jiggle + FLIP
 * drag, adapted from the bank layout engine), and toggle / rename the header
 * title. Layout persists server-side per session UUID via /api/topbar-layout.
 *
 * DOM-reuse strategy: we do NOT re-create the icons. The real <button> elements
 * already exist in #header-left-buttons / .header-buttons (revealed by main.js
 * per feature flag). We physically move those same elements between the two
 * clusters and the removed-tray, so their existing click handlers keep working.
 * The drawer rows are lightweight clones whose clicks proxy to realBtn.click().
 */

const HAMBURGER_ID = 'topbar-hamburger-btn';
const DEFAULT_TITLE = 'Walkscape Optimizer';
// Never customizable: the debug-session swap button is a transient affordance
// that only appears while an active debug session exists.
const EXCLUDE_IDS = new Set(['active-debug-swap-btn', HAMBURGER_ID]);
// Icons WITHOUT a selectable/active (open-section) state — no "selected" colors.
const NON_SELECTABLE = new Set(['info-btn', 'announcements-btn', 'report-btn', 'settings-btn', HAMBURGER_ID]);
const PAINT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z"/></svg>';
// Monochrome <img> icons that CAN be recolored via CSS mask (our own white SVGs).
const RECOLORABLE_IMG = {
  'stats-report-nav-btn': { src: '/assets/icons/stats-report.svg', imgSel: '.stats-report-bar-icon', wrapSel: '.stats-report-nav-icon-wrapper' },
};
const TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const LONG_PRESS_MS = 220;   // touch: hold this long to pick up an icon (else it's a scroll)
const TOUCH_SCROLL_SLOP = 12; // touch: move more than this before long-press => treat as scroll
const MOUSE_DRAG_SLOP = 4;

let S = null; // module singleton state

/* ---------- small DOM helpers ---------- */
function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function labelFor(btn) {
  return (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || btn.id || '').trim();
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ============================================================= *
 *  Public entry
 * ============================================================= */
export function initTopbarCustomization(flags) {
  if (!flags || !flags.topbar_customization) return;   // FAC gate — inert when off
  if (S) { console.log('[topbar-customization] already initialized — skipping'); return; }
  console.log('[topbar-customization] init start (flag ON)');
  const left = document.querySelector('.header-bar .header-left-buttons') || document.querySelector('.header-left-buttons');
  const right = document.querySelector('.header-bar .header-buttons') || document.querySelector('.header-buttons');
  const title = document.getElementById('header-title');
  if (!left || !right || !title) {
    console.warn('[topbar-customization] missing header elements — aborting', { left: !!left, right: !!right, title: !!title });
    return;
  }

  S = {
    left, right, title,
    registry: new Map(),   // id -> { id, label, defaultSide, defaultIndex, el }
    editing: false,
    drawerOpen: false,
    layout: null,
    tray: null, drawer: null, hamburger: null, titleEditor: null,
    pd: null, pdRAF: 0, autoScrollRAF: 0,
    colors: {}, styleEl: null,
    persist: debounce(pushLayout, 700),
  };

  buildRegistry();
  buildHamburger();
  buildDrawer();
  buildTray();
  buildTitleEditor();
  buildDimOverlay();
  buildColorStyleEl();
  syncEditVisibility(); // start with tray / dim hidden (not editing yet)

  // While editing, clicking an icon must NOT trigger its action/popup. Capture
  // phase so we intercept before the button's own click handler runs.
  const clickBlocker = (e) => {
    if (S.editing && e.target.closest('.tc-icon')) { e.preventDefault(); e.stopPropagation(); }
  };
  for (const c of [S.left, S.right, S.tray.slots]) c.addEventListener('click', clickBlocker, true);
  console.log('[topbar-customization] built — hamburger in DOM:', !!document.getElementById(HAMBURGER_ID),
    '| registry size:', S.registry.size, '| ids:', [...S.registry.keys()]);

  // Load saved layout, then apply (or fall back to default arrangement).
  fetch('/api/topbar-layout')
    .then(r => (r.ok ? r.json() : { layout: null }))
    .then(d => { console.log('[topbar-customization] saved layout:', d && d.layout); applyLayout(d && d.layout); })
    .catch((e) => { console.warn('[topbar-customization] layout fetch failed — using default:', e); applyLayout(null); });

  // Flush any pending save when the page is hidden (mobile nav away). sendBeacon
  // always POSTs, so use a keepalive PUT to hit the same route as pushLayout().
  window.addEventListener('pagehide', () => {
    if (S && S._dirty) {
      try {
        fetch('/api/topbar-layout', {
          method: 'PUT', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: serialize() }),
        });
      } catch (_) { /* best effort */ }
    }
  });
}

/* ============================================================= *
 *  Registry — the accessible customizable icons
 * ============================================================= */
function buildRegistry() {
  const scan = (container, side) => {
    let idx = 0;
    for (const btn of Array.from(container.children)) {
      if (btn.tagName !== 'BUTTON') continue;
      if (EXCLUDE_IDS.has(btn.id)) continue;
      // "Accessible" = revealed for this session. Flag-off icons keep an inline
      // display:none set in the markup and are never .show()n, so skip them.
      if (btn.style.display === 'none') continue;
      S.registry.set(btn.id, { id: btn.id, label: labelFor(btn), defaultSide: side, defaultIndex: idx++, el: btn });
      btn.classList.add('tc-icon');
      // Some icons are <img>/<svg> which the browser natively drags; kill that so
      // OUR pointer drag on the whole chip is what runs.
      btn.querySelectorAll('img, svg').forEach(n => n.setAttribute('draggable', 'false'));
      btn.addEventListener('dragstart', (e) => e.preventDefault());
    }
  };
  scan(S.left, 'left');
  scan(S.right, 'right');
}

function regList() { return Array.from(S.registry.values()); }
function alphaIds() { return regList().slice().sort((a, b) => a.label.localeCompare(b.label)).map(r => r.id); }

/* ============================================================= *
 *  Hamburger button (pinned leftmost, not movable)
 * ============================================================= */
function buildHamburger() {
  const b = el('button', 'tc-hamburger-btn', { id: HAMBURGER_ID, 'aria-label': 'Menu', title: 'Menu' });
  b.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3,3H21V5.5H3ZM3,10.75H21V13.25H3ZM3,18.5H21V21H3Z"/></svg>';
  b.addEventListener('click', () => toggleDrawer());
  S.left.insertBefore(b, S.left.firstChild);
  S.hamburger = b;
}

/* ============================================================= *
 *  Hamburger drawer (left slide-out)
 * ============================================================= */
function buildDrawer() {
  const overlay = el('div', 'tc-drawer-overlay', { 'aria-hidden': 'true' });
  overlay.addEventListener('click', () => toggleDrawer(false));

  const panel = el('aside', 'tc-drawer', { role: 'dialog', 'aria-label': 'Icon menu' });
  const head = el('div', 'tc-drawer-head');
  const heading = el('div', 'tc-drawer-title');
  heading.innerHTML = '<span class="tc-drawer-ham" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3,3H21V5.5H3ZM3,10.75H21V13.25H3ZM3,18.5H21V21H3Z"/></svg></span><span>Menu</span>';
  const hamBtn = heading.querySelector('.tc-drawer-ham');
  if (hamBtn) {
    hamBtn.setAttribute('role', 'button');
    hamBtn.setAttribute('title', 'Collapse menu');
    hamBtn.style.cursor = 'pointer';
    hamBtn.addEventListener('click', () => toggleDrawer(false));
  }
  const editWrap = el('label', 'tc-edit-toggle');
  const editCb = el('input', null, { type: 'checkbox' });
  editCb.addEventListener('change', () => setEditing(editCb.checked));
  editWrap.appendChild(editCb);
  editWrap.appendChild(document.createTextNode(' Edit icons'));
  const hint = el('div', 'tc-edit-hint');
  hint.textContent = 'Collapse this menu to edit the icons on the bar.';
  const resetBtn = el('button', 'tc-reset-btn', { type: 'button' });
  resetBtn.textContent = 'Reset to default';
  resetBtn.addEventListener('click', resetToDefault);

  head.appendChild(heading);
  head.appendChild(editWrap);
  head.appendChild(hint);
  head.appendChild(resetBtn);

  const list = el('div', 'tc-drawer-list');

  panel.appendChild(head);
  panel.appendChild(list);
  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  S.drawer = { overlay, panel, list, head, editCb, hint, resetBtn };
}

function toggleDrawer(force) {
  const open = force === undefined ? !S.drawerOpen : force;
  S.drawerOpen = open;
  document.body.classList.toggle('tc-drawer-open', open);
  if (open) renderDrawerList();
  // The bar-side edit affordances (jiggle, tray) are only meaningful while the
  // drawer is CLOSED — that's the "collapse this menu to edit the icons" flow.
  syncEditVisibility();
}

function renderDrawerList() {
  const list = S.drawer.list;
  list.innerHTML = '';
  const order = (S.layout && Array.isArray(S.layout.drawer) && S.layout.drawer.length)
    ? S.layout.drawer.filter(id => S.registry.has(id))
    : alphaIds();
  // Append any accessible icon missing from a stale saved drawer order.
  for (const id of alphaIds()) if (!order.includes(id)) order.push(id);

  for (const id of order) {
    const r = S.registry.get(id); if (!r) continue;
    const row = el('div', 'tc-drawer-row', { 'data-id': id });
    const iconClone = r.el.querySelector('svg, img');
    const icon = el('span', 'tc-drawer-icon');
    if (iconClone) icon.appendChild(iconClone.cloneNode(true));
    styleDrawerChip(icon, id); // custom-or-default background + glyph color
    const lbl = el('span', 'tc-drawer-label'); lbl.textContent = r.label;
    // Grip + checkbox are ALWAYS in the row (collapsed via CSS when not editing)
    // so they animate in AND out when edit mode toggles.
    const grip = el('span', 'tc-drag-grip', { 'aria-hidden': 'true' });
    grip.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3,5H21V7H3ZM3,11H21V13H3ZM3,17H21V19H3Z"/></svg>';
    const paint = el('button', 'tc-paint-btn', { type: 'button', 'aria-label': 'Customize colors', title: 'Customize colors' });
    paint.innerHTML = PAINT_SVG;
    paint.addEventListener('click', (e) => { e.stopPropagation(); if (S.editing) openColorModal(id); });
    const cb = el('input', 'tc-drawer-cb', { type: 'checkbox' });
    cb.checked = !isHidden(id);
    cb.addEventListener('change', () => setHidden(id, !cb.checked, /*fromDrawer*/true));
    row.appendChild(paint);
    row.appendChild(grip);
    row.appendChild(icon);
    row.appendChild(lbl);
    row.appendChild(cb);
    attachDrawerReorder(row); // no-op unless editing (guarded in the handler)
    row.addEventListener('click', (e) => {
      if (S.editing) return;                          // editing: no navigation
      if (e.target.closest('.tc-drawer-cb')) return;  // never navigate from the checkbox
      r.el.click(); toggleDrawer(false);
    });
    list.appendChild(row);
  }
  S.drawer.editCb.checked = S.editing;
}

/* Drawer rows are drag-reorderable (drawer order only; independent of the bar). */
function attachDrawerReorder(row) {
  row.addEventListener('pointerdown', (e) => {
    if (!S.editing) return; // reorder only in edit mode
    if (e.target.closest('input')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startY = e.clientY;
    let active = false;
    const list = S.drawer.list;
    const onMove = (ev) => {
      if (!active) {
        if (Math.abs(ev.clientY - startY) < 6) return;
        active = true;
        row.classList.add('tc-row-dragging');
        document.body.classList.add('tc-pd-dragging'); // reuses the global no-select/grabbing style
      }
      if (ev.cancelable) ev.preventDefault();
      const after = drawerRowAfter(list, ev.clientY);
      if (after === row || after === row.nextSibling) return; // position unchanged — don't re-flip (was janky)
      flipList(list, () => {
        if (after == null) list.appendChild(row);
        else list.insertBefore(row, after);
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      row.classList.remove('tc-row-dragging');
      document.body.classList.remove('tc-pd-dragging');
      if (active) { markDirty(); S.persist(); }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
  });
}
function drawerRowAfter(list, y) {
  const rows = Array.from(list.querySelectorAll('.tc-drawer-row'));
  for (const r of rows) {
    const box = r.getBoundingClientRect();
    if (y < box.top + box.height / 2) return r;
  }
  return null;
}

/* ============================================================= *
 *  Removed-icons tray (shown below the bar in edit mode)
 * ============================================================= */
function buildTray() {
  const tray = el('div', 'tc-tray', { 'aria-label': 'Removed icons' });
  const head = el('div', 'tc-tray-head');
  const lbl = el('span', 'tc-tray-title'); lbl.textContent = 'Removed icons — drag onto the bar to add';
  const reset = el('button', 'tc-reset-btn', { type: 'button' }); reset.textContent = 'Reset to default';
  reset.addEventListener('click', resetToDefault);
  const done = el('button', 'tc-done-btn', { type: 'button' }); done.textContent = 'Done';
  done.addEventListener('click', () => setEditing(false));
  const actions = el('div', 'tc-tray-actions');
  actions.appendChild(reset);
  actions.appendChild(done);
  head.appendChild(lbl);
  head.appendChild(actions);
  const slots = el('div', 'tc-tray-slots');
  tray.appendChild(head);
  tray.appendChild(slots);
  const bar = document.querySelector('.header-bar');
  bar.parentNode.insertBefore(tray, bar.nextSibling);
  S.tray = { tray, slots };
}

/* ============================================================= *
 *  Title editor (toggle off / rename) — shown in edit mode
 * ============================================================= */
function buildTitleEditor() {
  const wrap = el('div', 'tc-title-editor');
  const cbLabel = el('label', 'tc-title-enable');
  const cb = el('input', null, { type: 'checkbox' });
  cb.addEventListener('change', () => { setTitleEnabled(cb.checked); syncTitleInput(); });
  cbLabel.appendChild(cb);
  cbLabel.appendChild(document.createTextNode(' Show title'));
  const input = el('input', 'tc-title-input', { type: 'text', maxlength: '40', placeholder: DEFAULT_TITLE });
  input.addEventListener('input', () => { S.title.textContent = input.value || DEFAULT_TITLE; markDirty(); S.persist(); });
  wrap.appendChild(cbLabel);
  wrap.appendChild(input);
  // Lives in the removed-icons tray (bar-edit section), shown only in edit mode.
  S.tray.tray.appendChild(wrap);
  S.titleEditor = { wrap, cb, input };
  syncTitleInput();
}

/* The title text box only shows when "Show title" is checked. */
function syncTitleInput() {
  if (S.titleEditor) S.titleEditor.input.style.display = S.titleEditor.cb.checked ? '' : 'none';
}

function setTitleEnabled(on) {
  S.title.style.display = on ? '' : 'none';
  markDirty(); S.persist();
}

/* ============================================================= *
 *  Edit mode
 * ============================================================= */
function setEditing(on) {
  S.editing = on;
  document.body.classList.toggle('tc-editing', on);
  if (S.drawer.editCb.checked !== on) S.drawer.editCb.checked = on;
  // (Re)attach bar drag handlers for current icons.
  if (on) { attachBarDrag(); } else { detachBarDrag(); }
  // Do NOT re-render the drawer list here — the grip/checkbox persist in the DOM
  // and animate via CSS transitions on the tc-editing class (both in and out).
  if (S.drawer.editCb.checked !== on) S.drawer.editCb.checked = on;
  syncEditVisibility();
}

/* Dim + blur the rest of the page while editing the bar (header + tray stay crisp). */
function buildDimOverlay() {
  const o = el('div', 'tc-dim-overlay', { 'aria-hidden': 'true' });
  document.body.appendChild(o);
  S.dim = o;
}

/* Tray + jiggle only make sense when editing AND the drawer is collapsed. */
function syncEditVisibility() {
  const showBarEdit = S.editing && !S.drawerOpen;
  document.body.classList.toggle('tc-bar-edit', showBarEdit);
  if (S.tray) S.tray.tray.style.display = showBarEdit ? 'block' : 'none';
  if (S.dim) S.dim.style.display = showBarEdit ? 'block' : 'none';
}

/* ============================================================= *
 *  Hidden state
 * ============================================================= */
function isHidden(id) {
  const r = S.registry.get(id); if (!r) return false;
  return r.el.parentElement === (S.tray && S.tray.slots);
}
function setHidden(id, hidden, fromDrawer) {
  const r = S.registry.get(id); if (!r) return;
  if (hidden) {
    if (r.el.parentElement !== S.tray.slots) S.tray.slots.appendChild(r.el);
  } else {
    insertNearDefault(r);
  }
  markDirty(); S.persist();
  if (S.drawerOpen) renderDrawerList();
}

/* Re-add an icon near its default cluster + index (relative to what's present). */
function insertNearDefault(r) {
  const container = r.defaultSide === 'right' ? S.right : S.left;
  const kids = barIcons(container);
  let ref = null;
  for (const k of kids) {
    const kr = S.registry.get(k.id);
    if (kr && kr.defaultIndex > r.defaultIndex) { ref = k; break; }
  }
  if (ref) container.insertBefore(r.el, ref);
  else container.appendChild(r.el);
}

/* Draggable icons currently in a bar cluster (excludes the pinned hamburger). */
function barIcons(container) {
  return Array.from(container.children).filter(c => c.classList && c.classList.contains('tc-icon') && c.id !== HAMBURGER_ID);
}

/* ============================================================= *
 *  Apply / serialize layout
 * ============================================================= */
function applyLayout(layout) {
  S.layout = layout || null;
  const placed = new Set();

  const place = (ids, container) => {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      const r = S.registry.get(id);
      if (!r || placed.has(id)) continue;
      container.appendChild(r.el); // append in saved order (after hamburger for left)
      placed.add(id);
    }
  };

  if (layout && layout.topbar) {
    place(layout.topbar.left, S.left);
    place(layout.topbar.right, S.right);
    // Hidden icons -> tray.
    if (Array.isArray(layout.hidden)) {
      for (const id of layout.hidden) {
        const r = S.registry.get(id);
        if (r && !placed.has(id)) { S.tray.slots.appendChild(r.el); placed.add(id); }
      }
    }
  }
  // Any accessible icon not covered by the saved layout (new since save, or no
  // saved layout at all) -> restore to its default cluster/order.
  for (const r of regList()) {
    if (placed.has(r.id)) continue;
    insertNearDefault(r);
    placed.add(r.id);
  }

  // Title.
  const t = layout && layout.title;
  const enabled = !t || t.enabled !== false;
  S.title.textContent = (t && typeof t.text === 'string' && t.text) ? t.text : DEFAULT_TITLE;
  S.title.style.display = enabled ? '' : 'none';
  if (S.titleEditor) {
    S.titleEditor.cb.checked = enabled;
    S.titleEditor.input.value = (t && typeof t.text === 'string') ? t.text : '';
    syncTitleInput();
  }

  // Per-icon custom colors.
  S.colors = (layout && layout.colors && typeof layout.colors === 'object') ? layout.colors : {};
  applyColors();
}

function serialize() {
  return {
    topbar: {
      left: barIcons(S.left).map(b => b.id),
      right: barIcons(S.right).map(b => b.id),
    },
    hidden: S.tray ? Array.from(S.tray.slots.children).map(b => b.id) : [],
    drawer: S.drawer ? Array.from(S.drawer.list.querySelectorAll('.tc-drawer-row')).map(r => r.dataset.id) : [],
    title: {
      enabled: S.title.style.display !== 'none',
      text: (S.titleEditor && S.titleEditor.input.value) || '',
    },
    colors: S.colors || {},
  };
}

function markDirty() { S._dirty = true; S.layout = serialize(); }

function pushLayout() {
  const layout = serialize();
  S._dirty = false;
  fetch('/api/topbar-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  }).catch(() => { S._dirty = true; });
}

function resetToDefault() {
  fetch('/api/topbar-layout', { method: 'DELETE' }).catch(() => {});
  // Rebuild the default arrangement in-place.
  S.tray.slots.innerHTML = '';
  S.layout = null;
  applyLayout(null);
  if (S.drawerOpen) renderDrawerList();
  S._dirty = false;
}

/* ============================================================= *
 *  Bar drag: iPhone jiggle + FLIP reorder across clusters + tray
 *  (adapted from ui/static/js/bank/bank-view.js pointer engine)
 * ============================================================= */
function draggableTargets() {
  // All bar icons (both clusters, minus hamburger) + tray slots.
  return [...barIcons(S.left), ...barIcons(S.right), ...(S.tray ? Array.from(S.tray.slots.children) : [])];
}

function attachBarDrag() {
  for (const btn of draggableTargets()) {
    if (btn._tcDrag) continue;
    btn._tcDrag = (e) => onBarPointerDown(e, btn);
    btn.addEventListener('pointerdown', btn._tcDrag);
  }
}
function detachBarDrag() {
  for (const btn of [...barIcons(S.left), ...barIcons(S.right), ...(S.tray ? Array.from(S.tray.slots.children) : [])]) {
    if (btn._tcDrag) { btn.removeEventListener('pointerdown', btn._tcDrag); btn._tcDrag = null; }
  }
}

function onBarPointerDown(e, btn) {
  if (!S.editing || S.drawerOpen) return;
  if (S.pd) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  S.pd = { btn, x0: e.clientX, y0: e.clientY, ptype: e.pointerType, active: false, timer: null, lastX: e.clientX, lastY: e.clientY };
  window.addEventListener('pointermove', onBarPointerMove, { passive: false });
  window.addEventListener('pointerup', onBarPointerUp);
  window.addEventListener('pointercancel', onBarPointerUp);
  if (e.pointerType !== 'mouse') {
    S.pd.timer = setTimeout(() => { if (S.pd && !S.pd.active) beginBarDrag(S.pd.x0, S.pd.y0); }, LONG_PRESS_MS);
  }
}

function onBarPointerMove(e) {
  const pd = S.pd; if (!pd) return;
  const dx = e.clientX - pd.x0, dy = e.clientY - pd.y0;
  const dist = Math.hypot(dx, dy);
  if (!pd.active) {
    if (pd.ptype === 'mouse') { if (dist > MOUSE_DRAG_SLOP) beginBarDrag(e.clientX, e.clientY); }
    else if (dist > TOUCH_SCROLL_SLOP) { endBarDrag(); return; } // moved before long-press => let the bar scroll
    if (!pd.active) return;
  }
  if (e.cancelable) e.preventDefault();
  pd.lastX = e.clientX; pd.lastY = e.clientY;
  if (S.pdRAF) return;
  S.pdRAF = requestAnimationFrame(() => {
    S.pdRAF = 0;
    if (S.pd && S.pd.active) processBarMove(S.pd.lastX, S.pd.lastY);
  });
}

function beginBarDrag(x, y) {
  const pd = S.pd; if (!pd) return;
  pd.active = true;
  const rect = pd.btn.getBoundingClientRect();
  pd.w = rect.width; pd.h = rect.height;
  const proxy = el('div', 'tc-drag-proxy');
  proxy.style.width = rect.width + 'px';
  proxy.style.height = rect.height + 'px';
  const clone = pd.btn.cloneNode(true);
  clone.classList.remove('tc-icon');
  clone.style.margin = '0';
  proxy.appendChild(clone);
  document.body.appendChild(proxy);
  pd.proxy = proxy;
  // Placeholder occupies the icon's spot; the real button is hidden while dragging.
  const ph = el('div', 'tc-drag-placeholder');
  ph.style.width = rect.width + 'px';
  ph.style.height = rect.height + 'px';
  pd.btn.parentNode.insertBefore(ph, pd.btn);
  pd.placeholder = ph;
  pd.btn.classList.add('tc-dragging');
  document.body.classList.add('tc-pd-dragging');
  moveProxy(x, y);
  startAutoScroll();
}

function moveProxy(x, y) {
  const pd = S.pd; if (!pd || !pd.proxy) return;
  pd.proxy.style.transform = `translate3d(${x - pd.w / 2}px, ${y - pd.h / 2}px, 0)`;
}

function processBarMove(x, y) {
  moveProxy(x, y);
  const pd = S.pd; if (!pd) return;
  const dropC = dropContainerAt(x, y);
  if (!dropC) return;
  const ref = insertRefFor(dropC, x, y, pd.placeholder);
  if (ref === pd.placeholder) return;
  // Slide neighbours to make room (FLIP). Uses the `translate` CSS property so it
  // composes with the jiggle animation (which animates `rotate`) instead of
  // fighting it — icons keep wiggling while they glide.
  flipAcross([S.left, S.right, S.tray.slots], () => {
    if (ref == null) dropC.appendChild(pd.placeholder);
    else dropC.insertBefore(pd.placeholder, ref);
  });
}

/* Which container is under the pointer: a bar cluster or the tray. */
function dropContainerAt(x, y) {
  const under = document.elementFromPoint(x, y);
  if (!under) return null;
  if (S.tray && (under === S.tray.slots || S.tray.slots.contains(under) || under.closest('.tc-tray'))) return S.tray.slots;
  if (under.closest('.header-buttons')) return S.right;
  if (under.closest('.header-left-buttons')) return S.left;
  return null;
}

/* Horizontal insertion: first icon whose horizontal midpoint is right of x. */
function insertRefFor(container, x, y, placeholder) {
  const kids = Array.from(container.children).filter(c =>
    c !== placeholder && c.id !== HAMBURGER_ID && !c.classList.contains('tc-dragging'));
  for (const k of kids) {
    const box = k.getBoundingClientRect();
    if (x < box.left + box.width / 2) return k;
  }
  return null; // append at end
}

function onBarPointerUp() {
  const pd = S.pd; if (!pd) return;
  if (pd.active && pd.placeholder) {
    pd.placeholder.parentNode.insertBefore(pd.btn, pd.placeholder);
    pd.placeholder.remove();
    pd.btn.classList.remove('tc-dragging');
    if (pd.proxy) pd.proxy.remove();
    document.body.classList.remove('tc-pd-dragging');
    // Hidden state follows final home (tray => hidden).
    markDirty(); S.persist();
  }
  endBarDrag();
}

function endBarDrag() {
  const pd = S.pd;
  if (pd && pd.timer) clearTimeout(pd.timer);
  if (pd && pd.proxy && pd.proxy.parentNode) pd.proxy.remove();
  if (pd && pd.placeholder && pd.placeholder.parentNode) pd.placeholder.remove();
  if (pd && pd.btn) pd.btn.classList.remove('tc-dragging');
  document.body.classList.remove('tc-pd-dragging');
  stopAutoScroll();
  window.removeEventListener('pointermove', onBarPointerMove);
  window.removeEventListener('pointerup', onBarPointerUp);
  window.removeEventListener('pointercancel', onBarPointerUp);
  if (S.pdRAF) { cancelAnimationFrame(S.pdRAF); S.pdRAF = 0; }
  S.pd = null;
}

/* Horizontal edge auto-scroll for an overflowing cluster on mobile. */
function startAutoScroll() {
  if (S.autoScrollRAF) return;
  const EDGE = 48, MAX = 16;
  const tick = () => {
    S.autoScrollRAF = 0;
    const pd = S.pd; if (!pd || !pd.active) return;
    const x = pd.lastX;
    let scrolled = false;
    for (const c of [S.left, S.right, S.tray && S.tray.slots]) {
      if (!c) continue;
      const r = c.getBoundingClientRect();
      const maxScroll = c.scrollWidth - c.clientWidth;
      if (maxScroll <= 0) continue;
      if (pd.lastY < r.top - 24 || pd.lastY > r.bottom + 24) continue;
      let dx = 0;
      if (x < r.left + EDGE && c.scrollLeft > 0) dx = -Math.ceil(MAX * Math.min(1, (r.left + EDGE - x) / EDGE));
      else if (x > r.right - EDGE && c.scrollLeft < maxScroll) dx = Math.ceil(MAX * Math.min(1, (x - (r.right - EDGE)) / EDGE));
      if (dx) { const b = c.scrollLeft; c.scrollLeft = Math.max(0, Math.min(maxScroll, b + dx)); if (c.scrollLeft !== b) scrolled = true; }
    }
    if (scrolled) processBarMove(pd.lastX, pd.lastY);
    S.autoScrollRAF = requestAnimationFrame(tick);
  };
  S.autoScrollRAF = requestAnimationFrame(tick);
}
function stopAutoScroll() { if (S.autoScrollRAF) { cancelAnimationFrame(S.autoScrollRAF); S.autoScrollRAF = 0; } }

/* ---------- FLIP animation helpers ---------- */
function flipList(container, mutate) { flipAcross([container], mutate); }
function flipAcross(containers, mutate) {
  const els = [];
  for (const c of containers) for (const k of Array.from(c.children)) els.push(k);
  const first = new Map(els.map(k => [k, k.getBoundingClientRect()]));
  mutate();
  for (const k of els) {
    const a = first.get(k); if (!a) continue;
    if (!k.isConnected) continue;
    const b = k.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    // Use the individual `translate` property (NOT transform) so it layers with
    // the jiggle animation's `rotate` without either overriding the other.
    k.style.transition = 'none';
    k.style.translate = `${dx}px ${dy}px`;
    requestAnimationFrame(() => {
      k.style.transition = 'translate 170ms ease';
      k.style.translate = '0px 0px';
    });
  }
}

export default { init: initTopbarCustomization };

/* ============================================================= *
 *  Per-icon color customization (paintbrush -> modal)
 * ============================================================= */
function isGameImage(btn) { return !!btn.querySelector('img'); }     // <img> glyph
function isSelectable(id) { return !NON_SELECTABLE.has(id); }        // has an active/open-section state
function iconKind(id, btn) {
  if (btn.querySelector('svg')) return 'svg';
  if (RECOLORABLE_IMG[id]) return 'imgmono';   // monochrome <img> we can mask-tint
  return 'img';                                // colorful game image — not recolorable
}
function canRecolorIcon(id, btn) { return iconKind(id, btn) !== 'img'; }

function rgbToHex(c) {
  if (!c) return '#000000';
  c = String(c).trim();
  if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c.slice(0, 7);
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return '#000000';
  const p = m[1].split(',').map(s => parseInt(s.trim(), 10));
  const h = n => (isNaN(n) ? 0 : n).toString(16).padStart(2, '0');
  return '#' + h(p[0]) + h(p[1]) + h(p[2]);
}
/* Resolve any CSS color (hex / rgb / named like "white") to #rrggbb for <input type=color>. */
function toHex(c) {
  if (!c) return '#000000';
  c = String(c).trim();
  if (c[0] === '#' || c.startsWith('rgb')) return rgbToHex(c);
  const d = document.createElement('span');
  d.style.color = c; d.style.display = 'none';
  document.body.appendChild(d);
  const rgb = getComputedStyle(d).color;
  d.remove();
  return rgbToHex(rgb);
}
/* Inline-recolor a cloned <svg> (root + descendants, fill + stroke), or clear it. */
function recolorSvgInline(sv, col) {
  const set = (n) => {
    if (!n.getAttribute) return;
    const f = n.getAttribute('fill'), s = n.getAttribute('stroke');
    if (col) {
      n.style.color = col;
      if (f && f !== 'none') n.style.fill = col;
      if (s && s !== 'none') n.style.stroke = col;
    } else {
      n.style.color = ''; n.style.fill = ''; n.style.stroke = '';
    }
  };
  set(sv);
  sv.querySelectorAll('*').forEach(set);
}

function buildColorStyleEl() {
  let s = document.getElementById('tc-custom-colors');
  if (!s) { s = el('style', null, { id: 'tc-custom-colors' }); document.head.appendChild(s); }
  S.styleEl = s;
}

/* Regenerate the per-session <style> block from the saved colors. Applied to the
   REAL header buttons (so the live bar updates too), keyed by element id. */
function applyColors() {
  if (!S.styleEl) return;
  let css = '';
  for (const id in S.colors) {
    if (!S.registry.has(id)) continue;
    css += cssForIcon(id, S.colors[id]);
  }
  S.styleEl.textContent = css;
}

function cssForIcon(id, c) {
  const s = '#' + id;
  const rec = RECOLORABLE_IMG[id];
  const svgRecolor = (scope, col) =>
    `${scope} svg{color:${col} !important;}` +
    `${scope} svg[fill]:not([fill="none"]),${scope} svg *[fill]:not([fill="none"]){fill:${col} !important;}` +
    `${scope} svg[stroke]:not([stroke="none"]),${scope} svg *[stroke]:not([stroke="none"]){stroke:${col} !important;}`;
  const imgRecolor = (scope, col) =>
    `${scope} ${rec.imgSel}{visibility:hidden !important;}` +
    `${scope} ${rec.wrapSel}{position:relative;}` +
    `${scope} ${rec.wrapSel}::after{content:'';position:absolute;inset:0;background-color:${col};` +
    `-webkit-mask:url('${rec.src}') center/contain no-repeat;mask:url('${rec.src}') center/contain no-repeat;}`;
  const recolor = rec ? imgRecolor : svgRecolor;
  let css = '';
  if (c.bg) css += `${s}{background:${c.bg} !important;}`;
  if (c.icon) css += recolor(s, c.icon);
  if (c.sel) css += `${s}.active,${s}[aria-pressed="true"]{background:${c.sel} !important;box-shadow:0 0 12px 2px ${c.sel} !important;}`;
  if (c.selIcon) css += recolor(`${s}.active`, c.selIcon) + recolor(`${s}[aria-pressed="true"]`, c.selIcon);
  return css;
}

/* Default chip colors via id-less offscreen clones (normal + active variants). */
function defaultChipStyle(btn) {
  const mk = (active) => {
    const clone = btn.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.toggle('active', active);
    if (active) clone.setAttribute('aria-pressed', 'true'); else clone.removeAttribute('aria-pressed');
    clone.style.cssText = 'position:absolute;left:-9999px;top:-9999px;animation:none;transition:none;';
    (btn.parentNode || document.body).appendChild(clone);
    const cs = getComputedStyle(clone);
    const bgColor = cs.backgroundColor;
    const bgImage = cs.backgroundImage;
    // Representative SOLID color for the picker circle: use bg-color unless it's
    // transparent (e.g. the active state is a gradient), then pull the gradient's
    // first color stop.
    let repr = bgColor;
    if (!repr || repr === 'rgba(0, 0, 0, 0)' || repr === 'transparent') repr = firstColorOf(bgImage) || bgColor;
    const out = { bg: repr, bgImage, shadow: cs.boxShadow, icon: iconDefaultColor(clone) };
    clone.remove();
    return out;
  };
  const n = mk(false), s = mk(true);
  return {
    bg: n.bg, bgImage: n.bgImage, icon: n.icon,
    selBg: s.bg, selBgImage: s.bgImage, selIcon: s.icon, selShadow: s.shadow,
  };
}

/* First hex/rgb color token in a string (e.g. the first stop of a gradient). */
function firstColorOf(s) {
  if (!s) return null;
  const m = String(s).match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/);
  return m ? m[0] : null;
}

/* Best-guess default glyph color: an explicit fill/stroke attribute, else the
   inherited color. Reads the actual colored element (e.g. Walkdle's green rect). */
function iconDefaultColor(root) {
  const sv = root.querySelector('svg');
  if (!sv) return '#ffffff'; // monochrome <img> — treated as white
  const all = [sv, ...sv.querySelectorAll('*')];
  for (const n of all) { const f = n.getAttribute && n.getAttribute('fill'); if (f && f !== 'none' && f !== 'currentColor') return f; }
  for (const n of all) { const s = n.getAttribute && n.getAttribute('stroke'); if (s && s !== 'none' && s !== 'currentColor') return s; }
  return getComputedStyle(root).color || '#ffffff';
}

/* Recolor a chip's glyph (svg inline, or monochrome <img> via mask). col=null clears. */
function applyChipIcon(chip, btn, id, col) {
  const kind = iconKind(id, btn);
  if (kind === 'svg') {
    const sv = chip.querySelector('svg'); if (sv) recolorSvgInline(sv, col);
    return;
  }
  if (kind === 'imgmono') {
    const img = chip.querySelector('img'); if (!img) return;
    const rec = RECOLORABLE_IMG[id];
    if (col) {
      if (!img.dataset.tcOrig) img.dataset.tcOrig = img.getAttribute('src') || '';
      img.src = TRANSPARENT_PX;
      img.style.backgroundColor = col;
      img.style.webkitMaskImage = `url('${rec.src}')`; img.style.maskImage = `url('${rec.src}')`;
      img.style.webkitMaskRepeat = 'no-repeat'; img.style.maskRepeat = 'no-repeat';
      img.style.webkitMaskPosition = 'center'; img.style.maskPosition = 'center';
      img.style.webkitMaskSize = 'contain'; img.style.maskSize = 'contain';
    } else if (img.dataset.tcOrig) {
      img.src = img.dataset.tcOrig;
      img.style.backgroundColor = ''; img.style.webkitMaskImage = ''; img.style.maskImage = '';
    }
  }
}

function colorRow(id, label, key, defColor, onChange) {
  const wrap = el('div', 'tc-color-row');
  const lab = el('span', 'tc-color-label'); lab.textContent = label;
  const circle = el('label', 'tc-color-circle');
  const input = el('input', null, { type: 'color' });
  const cur = (S.colors[id] && S.colors[id][key]) || defColor;
  input.value = toHex(cur);
  circle.style.background = cur;
  input.addEventListener('input', () => {
    (S.colors[id] = S.colors[id] || {})[key] = input.value;
    circle.style.background = input.value;
    applyColors(); onChange(); markDirty(); S.persist();
  });
  circle.appendChild(input);
  const reset = el('button', 'tc-color-reset', { type: 'button', title: 'Reset ' + label });
  reset.textContent = '↺';
  reset.addEventListener('click', () => {
    if (S.colors[id]) { delete S.colors[id][key]; if (!Object.keys(S.colors[id]).length) delete S.colors[id]; }
    applyColors();
    input.value = toHex(defColor); circle.style.background = defColor;
    onChange(); markDirty(); S.persist();
  });
  wrap.appendChild(lab); wrap.appendChild(circle); wrap.appendChild(reset);
  return wrap;
}

function openColorModal(id) {
  const r = S.registry.get(id); if (!r) return;
  const recolor = canRecolorIcon(id, r.el);
  const selectable = isSelectable(id);
  const def = defaultChipStyle(r.el);

  const overlay = el('div', 'tc-cm-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', 'tc-cm', { role: 'dialog', 'aria-label': 'Customize ' + r.label });

  const closeBtn = el('button', 'tc-cm-close', { type: 'button', 'aria-label': 'Close' });
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => overlay.remove());

  const title = el('div', 'tc-cm-title'); title.textContent = r.label;

  const resetAll = el('button', 'tc-cm-reset-all', { type: 'button' });
  resetAll.textContent = 'Reset all colors';
  resetAll.addEventListener('click', () => {
    delete S.colors[id]; applyColors(); markDirty(); S.persist();
    overlay.remove(); openColorModal(id); // rebuild with defaults
  });

  const buildChip = () => {
    const chip = el('div', 'tc-cm-chip');
    const g = r.el.querySelector('svg, img');
    if (g) chip.appendChild(g.cloneNode(true));
    return chip;
  };
  const wrapPrev = (chip, label) => {
    const w = el('div', 'tc-cm-prev');
    const l = el('span', 'tc-cm-prev-lbl'); l.textContent = label;
    w.appendChild(chip); w.appendChild(l); return w;
  };
  const previews = el('div', 'tc-cm-previews');
  const chipNormal = buildChip();
  previews.appendChild(wrapPrev(chipNormal, 'Normal'));
  let chipSel = null;
  if (selectable) { chipSel = buildChip(); previews.appendChild(wrapPrev(chipSel, 'Selected')); }

  const styleChip = (chip, selected) => {
    const c = S.colors[id] || {};
    if (selected) {
      chip.style.background = c.sel || (def.selBgImage && def.selBgImage !== 'none' ? def.selBgImage : def.selBg);
      chip.style.boxShadow = c.sel ? `0 0 12px 2px ${c.sel}` : ((def.selShadow && def.selShadow !== 'none') ? def.selShadow : 'none');
    } else {
      chip.style.background = c.bg || (def.bgImage && def.bgImage !== 'none' ? def.bgImage : def.bg);
      chip.style.boxShadow = 'none';
    }
    if (recolor) {
      const icol = selected ? (c.selIcon || c.icon || def.selIcon || def.icon) : (c.icon || def.icon);
      applyChipIcon(chip, r.el, id, icol);
    }
  };
  const updatePreviews = () => { styleChip(chipNormal, false); if (chipSel) styleChip(chipSel, true); refreshDrawerChip(id); };

  const rows = el('div', 'tc-cm-rows');
  rows.appendChild(colorRow(id, 'Background', 'bg', def.bg, updatePreviews));
  if (recolor) rows.appendChild(colorRow(id, 'Icon', 'icon', def.icon, updatePreviews));
  if (selectable) rows.appendChild(colorRow(id, 'Selected background & glow', 'sel', def.selBg, updatePreviews));
  if (selectable && recolor) rows.appendChild(colorRow(id, 'Selected icon', 'selIcon', def.selIcon, updatePreviews));

  modal.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(resetAll);
  modal.appendChild(previews);
  modal.appendChild(rows);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  updatePreviews();
}

/* Style a menu (drawer) chip from custom-or-default colors. Preserves gradient
   defaults (e.g. Bank) when no custom background is set. */
function styleDrawerChip(iconEl, id) {
  const r = S.registry.get(id); if (!r || !iconEl) return;
  const c = S.colors[id] || {};
  if (c.bg) {
    iconEl.style.backgroundImage = 'none';
    iconEl.style.background = c.bg;
  } else {
    // Default background — copy the full computed background (keeps gradients),
    // with the active/selected state stripped.
    const wasActive = r.el.classList.contains('active');
    const wasPressed = r.el.getAttribute('aria-pressed') === 'true';
    if (wasActive) r.el.classList.remove('active');
    if (wasPressed) r.el.setAttribute('aria-pressed', 'false');
    const cs = getComputedStyle(r.el);
    iconEl.style.backgroundColor = cs.backgroundColor;
    iconEl.style.backgroundImage = (cs.backgroundImage && cs.backgroundImage !== 'none') ? cs.backgroundImage : 'none';
    if (cs.borderRadius && cs.borderRadius !== '0px') iconEl.style.borderRadius = cs.borderRadius;
    if (wasActive) r.el.classList.add('active');
    if (wasPressed) r.el.setAttribute('aria-pressed', 'true');
  }
  // Glyph color (recolorable icons — the cloned glyph needs explicit inline color).
  if (canRecolorIcon(id, r.el)) {
    applyChipIcon(iconEl, r.el, id, c.icon || null);
  }
}

function refreshDrawerChip(id) {
  if (!S.drawer || !S.drawer.list) return;
  const row = S.drawer.list.querySelector(`.tc-drawer-row[data-id="${id}"]`);
  const iconEl = row && row.querySelector('.tc-drawer-icon');
  if (iconEl) styleDrawerChip(iconEl, id);
}
