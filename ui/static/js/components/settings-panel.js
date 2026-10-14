/*
 * SettingsPanel / Toggle — a small framework for the optimizer options panel.
 *
 * Design goals (agreed in the Bunsho layout spec):
 *   - Render ONCE, then mutate in place on toggle/expand/resize. No re-render,
 *     so CSS / FLIP animations are never interrupted (no suppress-rerender hack).
 *   - A panel is a set of "lines" (addNewLine() breaks a line). Each line holds
 *     Toggles laid out by a measurement-based engine that implements the mock:
 *       * chips sit side by side; a chip only moves when geometry forces it
 *         (prefer NOT to move buttons);
 *       * an open Toggle shows its options box directly under it (single-open),
 *         or the open boxes shrink their internal wrap (3-in-row -> 2+1 ->
 *         stacked) so they fit side by side (both-open); only when even the
 *         tightest layout won't fit does the later Toggle wrap below;
 *       * boxes hug the widest wrapped row;
 *       * a connector links each open chip to its box (middle of chip / middle
 *         of box; >=25% inset from the chip edge when offset).
 *
 * Persistence reuses the existing WalkScape mechanism: on/off + values go
 * through window.settingsModal + saveGlobalOptimizationSettings() + a
 * "<settingName>Changed" event; inner <input>/<select> carrying
 * data-settings-name auto-save the same way. Collapse (caret) state is routed
 * through an injected onCollapseChange callback (the app passes api.updateConfig).
 */

/* ------------------------------------------------------------------ *
 * Base styles (injected once). Kept here so the framework is
 * self-contained for the test harness; can later move to styles.css.
 * ------------------------------------------------------------------ */
const SP_CSS = `
.sp-panel { width: 100%; box-sizing: border-box; }
.sp-line { position: relative; width: 100%; box-sizing: border-box; display: flex;
           flex-direction: column; align-items: stretch; margin-top: 6px; }
.sp-chiprow { display: flex; flex-wrap: wrap; justify-content: center;
              align-items: flex-start; gap: 8px 10px; }
/* The engine owns absolute placement of boxes + connectors in this layer. */
.sp-boxarea { position: relative; width: 100%; }
.sp-chip, .sp-subchip {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  box-sizing: border-box; cursor: pointer; user-select: none;
  border: 2px solid transparent;                 /* no visible border until selected (matches prod) */
  border-radius: 6px; padding: 2px 8px; background: var(--bg-primary, #0b0e16);
  color: var(--text-secondary, #9fb0c8); font-weight: 500; line-height: 1.2;
  /* Pin to the base 12px (scaled) rather than var(--font-size-sm): the
     surrounding .travel-config-panel bumps --font-size-sm to 14px, which made
     the chips read too big vs prod. Still honors --text-scale for a11y. */
  font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));
  white-space: nowrap;
  transition: border-color .25s ease-in-out, background .25s ease-in-out, color .25s ease-in-out;
}
.sp-chip.selected, .sp-subchip.selected {
  color: var(--text-primary, #cfe0f5);
  border-color: var(--sp-color, #6f8fb8);
  background: color-mix(in srgb, var(--sp-color, #6f8fb8) 22%, #000);
}
/* Focus must look identical to non-focus: no UA outline/ring lingering after a
   click-toggle. Border color stays whatever the selected/unselected state sets. */
.sp-chip:focus, .sp-chip:focus-visible,
.sp-subchip:focus, .sp-subchip:focus-visible,
.sp-caret:focus, .sp-caret:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
/* Hover changes ONLY the background. Overrides the global button:hover rule
   (which sets border-color to var(--accent-primary), a blue border); the
   chip border stays per selected state (transparent off, colored on). */
.sp-chip:hover, .sp-subchip:hover {
  border-color: transparent;
  background: color-mix(in srgb, #ffffff 9%, var(--bg-primary, #0b0e16));
}
.sp-chip.selected:hover, .sp-subchip.selected:hover {
  border-color: var(--sp-color, #6f8fb8);
  background: color-mix(in srgb, var(--sp-color, #6f8fb8) 30%, #000);
}
.sp-chip img, .sp-subchip img { width: 32px; height: 32px; flex-shrink: 0; object-fit: contain;
  transition: filter .25s ease-in-out, opacity .25s ease-in-out; }
.sp-chip:not(.selected) img, .sp-subchip:not(.selected) img { filter: grayscale(1); opacity: .6; }
.sp-caret { font-size: .8em; flex-shrink: 0; display: none; position: relative; cursor: pointer; transition: transform .2s ease-in-out; }
.sp-chip.has-caret .sp-caret { display: inline-block; } /* caret shows whenever the toggle has options, on or off */
.sp-chip.collapsed .sp-caret { transform: rotate(-90deg); }
/* Enlarge the caret's tap target (mobile): an invisible 22x28 box centered on it. */
.sp-caret::after { content: ''; position: absolute; top: 50%; left: 50%;
                   transform: translate(-50%, -50%); width: 22px; height: 28px; }
/* The connector + the options box share ONE sliding clip, so the connector
   stays attached and slides with the box (no pop-in / vanish). */
.sp-box-slot { position: absolute; top: 0; left: 0; will-change: transform;
               transition: transform .25s ease-in-out; }
.sp-box-outer { }
.sp-box-clip { position: relative; overflow: hidden; height: 0;
               transition: height .25s ease-in-out; }
.sp-box {
  position: relative; box-sizing: border-box;
  border: 2px solid var(--sp-color, #4fbf6f); border-radius: 11px;
  background: color-mix(in srgb, var(--sp-color, #4fbf6f) 8%, transparent);
  padding: 6px 8px; transition: width .25s ease-in-out, height .25s ease-in-out;
}
.sp-subchip { position: absolute; }
.sp-line-engine .sp-subchip {
  transition: left .25s ease-in-out, top .25s ease-in-out,
              border-color .25s ease-in-out, background .25s ease-in-out, color .25s ease-in-out;
}
.sp-connector { position: absolute; width: 4px; background: var(--sp-color, #4fbf6f);
                z-index: 1; transition: left .25s ease-in-out; }
/* Engine lines animate their own height so the panel below slides with them. */
.sp-line-engine { transition: height .25s ease-in-out; }
.sp-line-engine .sp-chip { transition: left .25s ease-in-out, top .25s ease-in-out,
                border-color .25s ease-in-out, background .25s ease-in-out, color .25s ease-in-out; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.id = 'sp-base-css';
  s.textContent = SP_CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ *
 * Persistence — reuse the existing WalkScape mechanism.
 * ------------------------------------------------------------------ */
const Persistence = {
  read(settingType, name) {
    const sm = window.settingsModal;
    if (!sm || !name) return undefined;
    return sm[name];
  },
  write(settingType, name, value, eventName) {
    const sm = window.settingsModal;
    if (!sm || !name) return;
    sm[name] = value;
    try { if (typeof sm.saveGlobalOptimizationSettings === 'function') sm.saveGlobalOptimizationSettings(); } catch (_) { /* non-fatal */ }
    try { window.dispatchEvent(new CustomEvent(eventName || (name + 'Changed'), { detail: { value } })); } catch (_) { /* non-fatal */ }
  },
};

/* ------------------------------------------------------------------ *
 * Toggle — one chip, optionally with a collapsable options box.
 *   new Toggle(icon, spanHTML, color, settingType, settingName, opts?)
 * ------------------------------------------------------------------ */
export class Toggle {
  constructor(icon, spanHTML, color, settingType, settingName, opts = {}) {
    this.icon = icon || '';
    this.spanHTML = spanHTML || '';
    this.color = color || '#6f8fb8';
    this.settingType = settingType || null;
    this.settingName = settingName || null;
    this.opts = opts; // { defaultOn, eventName, onInput(name,value), collapseKey }
    this.options = []; // collapsable sub-Toggles
    this.panel = null;
    this._buildDom();
  }

  _readOn() {
    // A host app can supply its own state source (opts.readOn) when the setting
    // does not live on window.settingsModal (e.g. a page's report-local config).
    if (typeof this.opts.readOn === 'function') return !!this.opts.readOn();
    if (!this.settingName) return !!this.opts.defaultOn;
    const v = Persistence.read(this.settingType, this.settingName);
    if (v === undefined) return !!this.opts.defaultOn;
    return !!v;
  }

  _buildDom() {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sp-chip';
    chip.style.setProperty('--sp-color', this.color);
    if (this.icon) {
      const img = document.createElement('img');
      img.src = this.icon; img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      chip.appendChild(img);
    }
    const label = document.createElement('span');
    label.className = 'sp-label';
    label.innerHTML = this.spanHTML;
    chip.appendChild(label);
    const caret = document.createElement('span');
    caret.className = 'sp-caret';
    caret.textContent = '▼';
    chip.appendChild(caret);
    this.chip = chip;
    this.caret = caret;

    // Toggle on/off when the chip (not the caret, not inner controls) is clicked.
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.sp-caret')) { this._toggleCollapsed(); return; }
      if (e.target.closest('input, select, a')) return; // inner controls handle themselves
      // Info popovers (ⓘ) live inside the chip but must not toggle it.
      if (e.target.closest('.sp-info, .travel-info-icon, [data-info], [data-info-html]')) return;
      this._setOn(!this._readOn());
    });

    // Auto-wire inner controls that carry data-settings-name.
    label.querySelectorAll('[data-settings-name]').forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      const handler = () => this._saveInnerControl(el);
      el.addEventListener('change', handler);
      if (el.tagName === 'INPUT') el.addEventListener('blur', handler);
    });

    this._syncChipState();
  }

  _saveInnerControl(el) {
    const name = el.getAttribute('data-settings-name');
    let value = el.value;
    if (el.type === 'number') { const n = parseInt(value, 10); value = Number.isFinite(n) ? n : value; }
    if (typeof this.opts.onInput === 'function') { this.opts.onInput(name, value); }
    else {
      Persistence.write(this.settingType, name, value);
      // Editing an inner control implies enabling the parent (matches current UX).
      if (this.settingName && !this._readOn()) this._setOn(true, /*silentLayout*/ true);
    }
  }

  attachCollapsableOption(...subToggles) {
    subToggles.forEach((t) => {
      t.chip.classList.remove('sp-chip'); t.chip.classList.add('sp-subchip');
      t.caret.remove(); // sub-toggles have no caret
      t._parent = this;               // back-ref for the linkedSubs reconcile
      this.options.push(t);
    });
    return this;
  }

  hasOptions() { return this.options.length > 0; }
  isOn() { return this._readOn(); }
  isExpanded() {
    // Linked-parent chips (opts.linkedSubs — e.g. the goals report's
    // "Include unavailable") behave like a normal collapsible chip: clicking
    // the parent OFF collapses the box. The ONE exception is when the parent
    // was AUTO-unchecked because the user turned off every sub-option — then
    // _keepOpenOverride forces the box to stay visible so the user can see the
    // (now all-off) sub-options and understand why the parent went off.
    if (this.opts.linkedSubs) {
      return !this._collapsed && (this.isOn() || !!this._keepOpenOverride);
    }
    return this.isOn() && !this._collapsed;
  }

  _setOn(on, silentLayout) {
    // If the host app supplies onToggle it owns persistence + all side-effects
    // (checkbox mirroring, correctly-shaped events, suppress-render windows);
    // we only reflect the visual state here. Otherwise fall back to the
    // built-in Persistence write (used by the standalone test harness).
    if (typeof this.opts.onToggle === 'function') {
      this.opts.onToggle(on);
    } else if (this.settingName) {
      Persistence.write(this.settingType, this.settingName, on, this.opts.eventName);
    }
    this._syncChipState();

    // --- linked parent/sub behavior (opt-in via opts.linkedSubs on the parent) ---
    // Applies ONLY to chips flagged linkedSubs (the goals report's "Include
    // unavailable"); the old consumables/pets chips are untouched. Invariant:
    // parent is ON iff at least one sub is ON. The sub-box never auto-collapses
    // when the parent flips OFF, so the user can still see the unchecked subs.
    if (this.opts.linkedSubs && !this._cascading && !this._reconciling) {
      // Parent clicked directly -> cascade to its subs.
      this._cascadeToSubs(on);
    }
    if (this._parent && this._parent.opts && this._parent.opts.linkedSubs && !this._parent._cascading) {
      // A sub changed -> reconcile the parent (= anySubOn), keep box open.
      this._parent._reconcileLinkedParent();
    }

    if (!silentLayout && this.panel) this.panel.relayout();
  }

  /* Parent (linkedSubs) was clicked: turn OFF -> all subs off (remembering the
   * prior set); turn ON -> restore the remembered set, else the defaultOn subs,
   * else the first sub. Never collapses the box. Guarded by _cascading so the
   * sub writes below don't recursively reconcile the parent. */
  _cascadeToSubs(on) {
    this._cascading = true;
    try {
      if (!on) {
        this._savedSubState = this.options.map((o) => o.isOn());
        this.options.forEach((o) => { if (o.isOn()) o._setOn(false, true); });
      } else {
        const saved = this._savedSubState;
        const anySaved = Array.isArray(saved) && saved.some(Boolean);
        this.options.forEach((o, i) => {
          const want = anySaved ? !!saved[i] : !!o.opts.defaultOn;
          if (o.isOn() !== want) o._setOn(want, true);
        });
        if (!this.options.some((o) => o.isOn())) {
          const first = this.options.find((o) => o.opts.defaultOn) || this.options[0];
          if (first) first._setOn(true, true);
        }
      }
    } finally { this._cascading = false; }
    // Direct parent click is a normal collapse interaction: clear the
    // keep-open override so OFF collapses the box (isExpanded() -> false) and
    // ON shows it again. (The "stay open while off" behavior is reserved for
    // the sub-driven auto-uncheck path in _reconcileLinkedParent.)
    this._keepOpenOverride = false;
    if (on) { this._collapsed = false; this.chip.classList.remove('collapsed'); }
  }

  /* A sub of a linkedSubs parent changed: set parent = anySubOn (without
   * cascading back to the subs). When the user turned off the LAST sub, the
   * parent auto-unchecks but the box STAYS OPEN (_keepOpenOverride) so they can
   * see the all-off sub-options; turning any sub back on clears the override. */
  _reconcileLinkedParent() {
    const anyOn = this.options.some((o) => o.isOn());
    if (this.isOn() !== anyOn) {
      this._reconciling = true;
      try { this._setOn(anyOn, true); } finally { this._reconciling = false; }
    }
    if (anyOn) {
      // At least one sub is on -> normal: the parent is on, drop any override.
      this._keepOpenOverride = false;
    } else {
      // User just turned off the LAST sub -> parent auto-unchecks but keep the
      // box open so they can see every sub is now off.
      this._keepOpenOverride = true;
      this._collapsed = false;
      this.chip.classList.remove('collapsed');
    }
  }

  _toggleCollapsed() {
    this._collapsed = !this._collapsed;
    this.chip.classList.toggle('collapsed', this._collapsed);
    if (this.opts.collapseKey && this.panel && this.panel.onCollapseChange) {
      this.panel.onCollapseChange(this.opts.collapseKey, this._collapsed);
    }
    if (this.panel) this.panel.relayout();
  }

  /* Reflect current on/off into the chip without firing events (idempotent). */
  _syncChipState() {
    const on = this._readOn();
    this.chip.classList.toggle('selected', on);
    this.chip.classList.toggle('on', on && this.hasOptions());
    this.chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.options.forEach((t) => t._syncChipState());
  }
}

/* ------------------------------------------------------------------ *
 * SettingsPanel — container + layout engine.
 * ------------------------------------------------------------------ */
export class SettingsPanel {
  constructor(opts = {}) {
    injectCss();
    this.opts = opts;
    this.settingType = opts.settingType || null;
    this.gap = opts.gap != null ? opts.gap : 10;
    this.connLen = opts.connectorLen != null ? opts.connectorLen : 8;
    this.onCollapseChange = opts.onCollapseChange || null;
    this.lines = [[]]; // array of lines; each line is an array of Toggles
    this.element = document.createElement('div');
    this.element.className = 'sp-panel';
    this._built = false;
    this._ro = null;
  }

  addToggle(...toggles) {
    toggles.forEach((t) => {
      t.panel = this;
      if (t.settingType == null) t.settingType = this.settingType;
      t.options.forEach((o) => { o.panel = this; if (o.settingType == null) o.settingType = this.settingType; });
      this.lines[this.lines.length - 1].push(t);
    });
    if (this._built) this._buildDom();
    return this;
  }

  addNewLine() { this.lines.push([]); if (this._built) this._buildDom(); return this; }

  /* Build the DOM once. Chips go in .sp-chiprow; each open box lives in an
   * absolutely-placed .sp-box-slot inside .sp-boxarea, positioned by relayout. */
  _buildDom() {
    this.element.innerHTML = '';
    this._lineEls = [];
    this.lines.forEach((line) => {
      if (!line.length) return;
      const engine = line.some((t) => t.hasOptions());
      const lineEl = document.createElement('div');
      lineEl.className = 'sp-line' + (engine ? ' sp-line-engine' : ' sp-line-simple');

      if (!engine) {
        // No option-toggles: a plain centered, wrapping chip row (CSS flow).
        const chiprow = document.createElement('div');
        chiprow.className = 'sp-chiprow';
        line.forEach((t) => { t.chip.classList.remove('has-caret'); chiprow.appendChild(t.chip); });
        lineEl.appendChild(chiprow);
      } else {
        // Engine line: chips + option boxes are absolutely positioned by the
        // layout engine so a chip can wrap BELOW another chip's box when needed.
        line.forEach((t) => {
          t.chip.classList.toggle('has-caret', t.hasOptions());
          t.chip.classList.toggle('collapsed', !!t._collapsed);
          t.chip.style.position = 'absolute';
          lineEl.appendChild(t.chip);
          if (t.hasOptions()) {
            // slot -> outer -> clip(overflow, slides) -> [connector][box]
            const slot = document.createElement('div'); slot.className = 'sp-box-slot';
            const outer = document.createElement('div'); outer.className = 'sp-box-outer';
            const clip = document.createElement('div'); clip.className = 'sp-box-clip';
            const conn = document.createElement('div'); conn.className = 'sp-connector'; conn.style.setProperty('--sp-color', t.color);
            const box = document.createElement('div'); box.className = 'sp-box';
            box.style.setProperty('--sp-color', t.color);
            box.style.marginTop = this.connLen + 'px';   // leaves room for the connector above it
            t.options.forEach((o) => box.appendChild(o.chip));
            clip.appendChild(conn); clip.appendChild(box); outer.appendChild(clip); slot.appendChild(outer);
            lineEl.appendChild(slot);
            t._slot = slot; t._box = box; t._clip = clip; t._conn = conn;
          }
        });
      }
      this.element.appendChild(lineEl);
      this._lineEls.push({ lineEl, line, engine });
    });
    this._built = true;
    this._observe();
    this.relayout();
  }

  mount(parent) { if (!this._built) this._buildDom(); parent.appendChild(this.element); this.relayout(); return this; }

  /* Re-read every chip's on/off from the persistence surface and relayout.
   * Call after an external change (settings modal, another surface, or an
   * inner control edit) so the framework chips reflect the new state without
   * a teardown. _syncChipState on a parent also syncs its options. */
  syncState() {
    if (!this._built) return this;
    this.lines.forEach((line) => line.forEach((t) => t._syncChipState()));
    this.relayout();
    return this;
  }

  _observe() {
    if (this._ro) this._ro.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(() => this.relayout());
    this._ro.observe(this.element);
  }

  /* ---- layout engine ---- */
  relayout() {
    if (!this._built || !this.element.isConnected) return;
    // Two rAFs: first lets any just-opened box render so we can measure it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (this._lineEls || []).forEach((L) => this._layoutLine(L));
    }));
  }

  _layoutLine(L) {
    if (!L.engine) return;                    // simple lines flow via CSS
    const line = L.line;
    const lineW = L.lineEl.clientWidth;
    if (!lineW) return;
    const gap = this.gap, conn = this.connLen, unitGap = 8;
    const animChips = !!L._laidOut;           // don't animate the very first layout

    const open = line.filter((t) => t.hasOptions() && t.isExpanded());
    // Slide-up / hide any closed option boxes.
    line.forEach((t) => { if (t.hasOptions() && !t.isExpanded()) this._hideBox(t); });

    const chipW = line.map((t) => t.chip.offsetWidth);
    const chipH = Math.max.apply(null, line.map((t) => t.chip.offsetHeight));
    const n = line.length;
    const chipsRowW = chipW.reduce((a, b) => a + b, 0) + gap * (n - 1);
    const chipsFit = chipsRowW <= lineW;

    // Do the open boxes fit side by side (after shrinking 3->2+1->stacked)?
    let sideBySide = true, boxesRowW = 0;
    const chosen = new Map();
    if (open.length) {
      const lays = this._fitBoxes(open, lineW);
      open.forEach((t, i) => chosen.set(t, lays[i]));
      boxesRowW = lays.reduce((a, l) => a + l.width, 0) + gap * (open.length - 1);
      sideBySide = open.length <= 1 ? true : (chipsFit && boxesRowW <= lineW);
    }

    // "Mixed" = some chips on this line have an open box, others don't (e.g. the
    // goals report's consumables+pets open alongside plain run-locally/fast).
    // Box-align row mode only lays out cleanly when EVERY chip on the line is an
    // open box (Column 3); with plain chips mixed in it moves the open chips
    // over their boxes and leaves the plain chips overlapping. Route mixed lines
    // to wrapped mode (chips stay put in a row, boxes drop beneath).
    const mixedOpen = open.length > 0 && open.length < line.length;

    if (chipsFit && sideBySide && !mixedOpen) {
      // ---- ROW MODE: chips centered on top, option boxes directly below ----
      // Compute EVERY chip's final x with pure math first, write each chip
      // exactly once, THEN reveal the boxes. Writing a chip twice (centered,
      // then box-aligned) with a forced reflow between the writes -- which
      // _showBox does via `void offsetWidth` -- commits the intermediate
      // centered position as the transition start, so the chip animates toward
      // center first and re-targets to its final spot only after the box slide
      // (the two-phase "move a little, then the rest at the end" on toggle-on).
      const chipX = new Array(n);      // final left per chip (index-aligned to `line`)
      const cx = new Map();            // centered chip-center per toggle
      let x = (lineW - chipsRowW) / 2;
      line.forEach((t, i) => { chipX[i] = x; cx.set(t, x + chipW[i] / 2); x += chipW[i] + gap; });

      const placements = [];           // {t, bx, lay, connCenter}
      let maxBoxH = 0;
      if (open.length === 1) {
        const t = open[0]; const lay = chosen.get(t); const w = lay.width;
        let left = cx.get(t) - w / 2;
        left = Math.max(0, Math.min(left, lineW - w));   // clamp -> A2 becomes row-centered
        placements.push({ t, bx: left, lay, connCenter: cx.get(t) });
        maxBoxH = lay.height;
      } else {
        let bx = (lineW - boxesRowW) / 2;
        open.forEach((t) => {
          const lay = chosen.get(t); const w = lay.width; const bc = bx + w / 2;
          const idx = line.indexOf(t); const cc = cx.get(t); const half = chipW[idx] / 2;
          let eff = cc;
          if (Math.abs(cc - bc) > half) { chipX[idx] = bc - half; eff = bc; }   // shift chip over its box
          placements.push({ t, bx, lay, connCenter: eff });
          maxBoxH = Math.max(maxBoxH, lay.height);
          bx += w + gap;
        });
      }

      // Write all chip positions once (before any reflow), then place boxes.
      line.forEach((t, i) => this._setChip(t, chipX[i], 0, animChips));
      placements.forEach((p) => { this._showBox(p.t, p.bx, chipH, p.lay, animChips); this._showConn(p.t, p.connCenter, p.bx, p.lay.width); });
      this._setLineHeight(L, chipH + conn + maxBoxH + 2);
    } else if (!chipsFit || mixedOpen) {
      // ---- WRAPPED MODE: chips flow into multiple centered rows (never
      // one-per-line). Each expanded toggle's box drops directly beneath its
      // chip's row. Used when the chips overflow one row (e.g. the goals
      // report's 5 chips) whether or not a box is open. ----
      const rowGap = 8;
      const rows = [];
      let cur = [];
      line.forEach((t, i) => {
        if (!cur.length) { cur.push(i); return; }
        const rowW = cur.reduce((a, j) => a + chipW[j], 0) + gap * (cur.length - 1);
        if (rowW + gap + chipW[i] <= lineW) cur.push(i);
        else { rows.push(cur); cur = [i]; }
      });
      if (cur.length) rows.push(cur);

      let y = 0;
      rows.forEach((r) => {
        const rowW = r.reduce((a, i) => a + chipW[i], 0) + gap * (r.length - 1);
        let x = Math.max(0, (lineW - rowW) / 2);
        const center = {};
        r.forEach((i) => { this._setChip(line[i], x, y, animChips); center[i] = x + chipW[i] / 2; x += chipW[i] + gap; });
        y += chipH;
        // Option B: place each expanded toggle's box UNDER ITS CHIP, side by
        // side, shrinking wide boxes (3-in-row -> 2+1 -> stacked) so neighbours
        // don't overlap -- rather than stacking boxes vertically. Each box is
        // confined to the horizontal "cell" around its chip: bounded by the
        // midpoint to the adjacent OPEN chip on each side (or the line edges).
        // We shrink the box before ever pushing a chip to another row.
        const openInRow = r.filter((i) => line[i].hasOptions() && line[i].isExpanded());
        if (openInRow.length) {
          let maxBoxH = 0;
          openInRow.forEach((idx, k) => {
            const t = line[idx];
            const c = center[idx];
            const leftBound = k > 0 ? (center[openInRow[k - 1]] + c) / 2 + gap / 2 : 0;
            const rightBound = k < openInRow.length - 1 ? (c + center[openInRow[k + 1]]) / 2 - gap / 2 : lineW;
            // Width available to this box = the FULL span between its neighbour
            // midpoints (or line edges), NOT a cell forced symmetric around the
            // chip. The old `2*min(c-leftBound, rightBound-c)` halved the box
            // for a chip sitting near a line edge (e.g. the rightmost
            // "Include unavailable" chip), cramping its options into 2-per-row
            // even when the line had plenty of room. The asymmetric clamp below
            // still keeps the box inside [leftBound, rightBound] so adjacent
            // open boxes never overlap.
            const cellW = rightBound - leftBound;
            const lay = this._fitBoxSingle(t, Math.max(cellW, 1));
            let left = Math.max(leftBound, Math.min(c - lay.width / 2, rightBound - lay.width));
            left = Math.max(0, Math.min(left, lineW - lay.width));
            this._showBox(t, left, y, lay, animChips);
            this._showConn(t, c, left, lay.width);
            maxBoxH = Math.max(maxBoxH, lay.height);
          });
          y += conn + maxBoxH;
        }
        y += rowGap;
      });
      this._setLineHeight(L, Math.max(chipH, y - rowGap));
    } else {
      // ---- STACKED MODE: vertical units (chip, then its box) in order ----
      let y = 0;
      line.forEach((t, i) => {
        this._setChip(t, (lineW - chipW[i]) / 2, y, animChips);
        y += chipH;
        if (t.hasOptions() && t.isExpanded()) {
          const lay = this._fitBoxSingle(t, lineW);
          const w = lay.width;
          const left = (lineW - w) / 2;
          this._showBox(t, left, y, lay, animChips);   // clip at chip bottom; connector inside at its top
          this._showConn(t, lineW / 2, left, w);
          y += conn + lay.height;
        }
        y += unitGap;
      });
      this._setLineHeight(L, y);
    }

    line.forEach((t) => { if (t.hasOptions()) t._wasOpen = t.isExpanded(); });
    L._laidOut = true;
  }

  /* Choose the widest internal layout per open box so the set fits side by side.
   * Shrinks the widest box one step at a time (3-in-row -> 2+1 -> stacked ...).
   * Returns an array of layout objects (see _boxLayouts). */
  _fitBoxes(openToggles, lineWidth) {
    const budget = lineWidth - this.gap * (openToggles.length - 1);
    const states = openToggles.map((t) => ({ t, cands: this._boxLayouts(t), idx: 0 }));
    const total = () => states.reduce((sum, s) => sum + s.cands[s.idx].width, 0);
    let guard = 0;
    while (total() > budget && guard++ < 50) {
      let widest = -1, wi = -1;
      states.forEach((s, i) => { if (s.idx < s.cands.length - 1 && s.cands[s.idx].width > widest) { widest = s.cands[s.idx].width; wi = i; } });
      if (wi === -1) break; // nothing left to shrink
      states[wi].idx++;
    }
    return states.map((s) => s.cands[s.idx]);
  }

  /* Candidate box layouts, widest (all sub-chips on one row) -> narrowest (fully
   * stacked). Each layout gives the box border-box width/height and the absolute
   * (left,top) of every sub-chip, so sub-chips can glide between layouts. */
  _boxLayouts(t) {
    const opts = t.options;
    const n = opts.length;
    const padX = 8, padY = 6, border = 2, subGap = 8;
    const w = opts.map((o) => o.chip.offsetWidth);
    const ch = Math.max.apply(null, opts.map((o) => o.chip.offsetHeight));
    const out = [];
    for (let k = n; k >= 1; k--) {
      const rows = [];
      for (let i = 0; i < n; i++) { (rows[Math.floor(i / k)] = rows[Math.floor(i / k)] || []).push(i); }
      const rowW = rows.map((r) => r.reduce((a, idx) => a + w[idx], 0) + subGap * (r.length - 1));
      const contentW = Math.max.apply(null, rowW);
      const contentH = rows.length * ch + subGap * (rows.length - 1);
      const positions = [];
      rows.forEach((r, ri) => {
        let x = padX + (contentW - rowW[ri]) / 2;         // center each row
        const top = padY + ri * (ch + subGap);
        r.forEach((idx) => { positions[idx] = { left: x, top }; x += w[idx] + subGap; });
      });
      out.push({ k, width: Math.ceil(contentW + 2 * padX + 2 * border), height: Math.ceil(contentH + 2 * padY + 2 * border), positions });
    }
    return out.filter((c, i) => i === 0 || c.width !== out[i - 1].width);
  }

  _fitBoxSingle(t, maxWidth) {
    const cands = this._boxLayouts(t);
    let chosen = cands[cands.length - 1];
    for (const c of cands) { if (c.width <= maxWidth) { chosen = c; break; } }
    return chosen;
  }

  /* Position a chip (top-level or sub). The color transition (select/deselect
   * fade) is ALWAYS kept; only the left/top move transition is added when
   * animate is true (otherwise the position jumps but the color still fades). */
  _setChip(t, left, top, animate) {
    const el = t.chip;
    const COLOR_T = 'border-color .25s ease-in-out, background .25s ease-in-out, color .25s ease-in-out';
    el.style.transition = animate ? ('left .25s ease-in-out, top .25s ease-in-out, ' + COLOR_T) : COLOR_T;
    el.style.left = left.toFixed(1) + 'px';
    el.style.top = top.toFixed(1) + 'px';
  }

  _setSlot(slot, left, top, animate) {
    const v = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    if (animate) { slot.style.transform = v; }
    else { slot.style.transition = 'none'; slot.style.transform = v; void slot.offsetWidth; slot.style.transition = ''; }
  }

  _setBoxSize(box, w, h, animate) {
    if (animate) { box.style.width = w + 'px'; box.style.height = h + 'px'; }
    else { box.style.transition = 'none'; box.style.width = w + 'px'; box.style.height = h + 'px'; void box.offsetWidth; box.style.transition = ''; }
  }

  /* Reveal / resize an option box.
   * - Just opened: sub-chips + box jump to final layout, then it slides DOWN
   *   (clip height 0 -> h). No horizontal fly-in, no fade.
   * - Reflow while open: sub-chips glide to new spots, box width/height (side +
   *   bottom borders) and the slide height all animate.
   * `animate` is false on the very first layout (jump everything). */
  _showBox(t, left, top, layout, animate) {
    const box = t._box, clip = t._clip, slot = t._slot;
    const justOpened = !t._wasOpen;
    const reflow = animate && !justOpened;         // glide inner pieces only when already open
    t.options.forEach((o, i) => { const p = layout.positions[i]; this._setChip(o, p.left, p.top, reflow); });
    this._setBoxSize(box, layout.width, layout.height, reflow);
    this._setSlot(slot, left, top, reflow);        // slot sits at the chip's bottom (connector is inside, at top)
    const clipH = this.connLen + layout.height;    // connector + box slide together
    if (animate) { clip.style.height = clipH + 'px'; }
    else { clip.style.transition = 'none'; clip.style.height = clipH + 'px'; void clip.offsetWidth; clip.style.transition = ''; }
    return layout.height;
  }

  _hideBox(t) {
    if (t._clip) t._clip.style.height = '0px';      // slide up (connector inside the clip goes with it)
  }

  /* Animate (or jump on first layout) the engine line's own height so the panel
   * below slides with the open/close instead of jumping. */
  _setLineHeight(L, h) {
    if (L._laidOut) { L.lineEl.style.height = h.toFixed(1) + 'px'; }
    else { L.lineEl.style.transition = 'none'; L.lineEl.style.height = h.toFixed(1) + 'px'; void L.lineEl.offsetWidth; L.lineEl.style.transition = ''; }
  }

  /* Connector stub, positioned INSIDE the clip (which sits at the box's left):
   * middle of chip / middle of box; >=25% inside the chip edge when offset. */
  _showConn(t, chipCenter, boxLeft, boxW) {
    const conn = t._conn;
    const chipW = t.chip.offsetWidth;
    const minX = chipCenter - chipW * 0.25;
    const maxX = chipCenter + chipW * 0.25;
    let x = chipCenter;
    x = Math.max(boxLeft + 4, Math.min(x, boxLeft + boxW - 4)); // keep the stub over the box
    x = Math.max(minX, Math.min(x, maxX));                      // but within 25% of the chip edges
    conn.style.left = (x - boxLeft - 2).toFixed(1) + 'px';      // local to the clip (clip is at boxLeft)
    conn.style.top = '0px';
    conn.style.height = (this.connLen + 1) + 'px';              // 1px overlap into the box
  }
}

export default SettingsPanel;
