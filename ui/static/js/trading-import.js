/**
 * trading-import.js — bulk import wizard for My Wishlist / My Listings.
 *
 * Flow (see TRADE_IMPORT_TASKS.md): upload csv/txt/xlsx -> map columns ->
 * validate (good/bad + duplicates + owned) -> choose per-row + global handling
 * -> commit. Catalog resolution, parsing and validation are all server-side
 * (/api/trading/import/*); this module only drives the UI and the decisions.
 *
 * Entry point: openTradeImport(tradingPage, kind) where kind is
 * 'wishlist' | 'listings'. Reuses tradingPage._modal for the shell.
 */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pretty(slug) { return (window.prettyName ? window.prettyName(slug) : slug); }

async function apiJson(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const resp = await fetch(path, opts);
    if (!resp.ok) {
        let detail = resp.statusText;
        try { detail = (await resp.json()).detail || detail; } catch (e) { /* non-JSON */ }
        throw new Error(detail);
    }
    return resp.status === 204 ? null : resp.json();
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result || ''); res(s.substring(s.indexOf(',') + 1)); };
        r.onerror = () => rej(new Error('Could not read the file'));
        r.readAsDataURL(file);
    });
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function button(label, variant) {
    const b = el('button', 'btn' + (variant ? ' btn-' + variant : ''));
    b.type = 'button';
    b.textContent = label;
    return b;
}

const FIELDS = [
    { key: 'item_name', label: 'Item Name', required: true },
    { key: 'quality', label: 'Quality', required: false },
    { key: 'quantity', label: 'Quantity', required: false },
    { key: 'price', label: 'Price (gold)', required: false },
    { key: 'notes', label: 'Notes', required: false },
];

const MAP_LS_KEY = (kind) => `ws_trade_import_map_${kind}`;

// Horizontal radio group: a tiny caption sits ABOVE each radio (per the agreed
// mobile-friendly layout — never a tall vertical stack).
function radioGroup(name, options, onChange, checkedValue) {
    const wrap = el('div', 'ti-radios');
    options.forEach((o) => {
        const cell = el('label', 'ti-radio');
        const cap = el('span', 'ti-radio-cap', o.label);
        const inp = document.createElement('input');
        inp.type = 'radio'; inp.name = name; inp.value = o.value;
        if (checkedValue && checkedValue === o.value) inp.checked = true;
        inp.addEventListener('change', () => onChange && onChange(o.value));
        cell.append(cap, inp);
        wrap.append(cell);
    });
    return wrap;
}

export function openTradeImport(page, kind) {
    const m = page._modal(`Import ${kind === 'listings' ? 'listings' : 'wishlist'} from file`, 760);
    const body = el('div', 'ti-wizard');
    m.panel.appendChild(body);

    const state = { token: null, columns: [], sample: [], total: 0, delimiter: '', mapping: {}, priceMode: '' };

    const setBody = (node) => { body.innerHTML = ''; body.appendChild(node); };

    // ── Step 1: upload ───────────────────────────────────────────────────────
    function stepUpload(err) {
        const wrap = el('div');
        const help = el('div', 'ti-help');
        help.innerHTML = 'Upload a <strong>.csv</strong>, <strong>.txt</strong> or <strong>.xlsx</strong> file. '
            + 'The first row must be a <strong>header</strong>. Columns: Item Name (name or game export), '
            + 'Quality, Quantity, Price, Notes — you map them on the next step.';
        wrap.appendChild(help);

        const tpl = el('div', 'ti-templates');
        tpl.innerHTML = 'Need a starting point? '
            + `<a href="/api/trading/import/template?kind=${kind}&fmt=csv">Download CSV template</a> · `
            + `<a href="/api/trading/import/template?kind=${kind}&fmt=xlsx">Download Excel template</a>`;
        wrap.appendChild(tpl);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv,.txt,.xlsx,.xlsm,text/csv,text/plain';
        fileInput.className = 'ti-file';
        wrap.appendChild(fileInput);

        // Delimiter override (shown only when the sniff was ambiguous).
        const delimRow = el('div', 'ti-delim');
        delimRow.style.display = 'none';
        wrap.appendChild(delimRow);

        const msg = el('div', 'ti-msg');
        if (err) { msg.textContent = err; msg.classList.add('ti-err'); }
        wrap.appendChild(msg);

        const next = button('Next', 'trade-green');
        next.disabled = true;
        fileInput.addEventListener('change', () => { next.disabled = !fileInput.files.length; });

        next.onclick = async () => {
            const f = fileInput.files[0];
            if (!f) return;
            next.disabled = true; next.textContent = 'Reading…';
            try {
                const content_base64 = await fileToBase64(f);
                const payload = { kind, filename: f.name, content_base64 };
                const picked = delimRow.querySelector('input:checked');
                if (picked) payload.delimiter = picked.value;
                const res = await apiJson('POST', '/api/trading/import/parse', payload);
                state.token = res.token; state.columns = res.columns; state.sample = res.sample;
                state.total = res.total_rows; state.delimiter = res.delimiter;
                // Prefer a remembered mapping for the same header signature.
                let mapping = res.suggested_mapping || {};
                try {
                    const saved = JSON.parse(localStorage.getItem(MAP_LS_KEY(kind)) || 'null');
                    if (saved && saved.sig === state.columns.join('|')) mapping = saved.mapping;
                } catch (e) { /* ignore */ }
                state.mapping = mapping;
                stepMap();
            } catch (e) {
                next.disabled = false; next.textContent = 'Next';
                msg.textContent = e.message; msg.classList.add('ti-err');
            }
        };

        wrap.appendChild(rowButtons([next]));
        setBody(wrap);
    }

    // ── Step 2: map columns ───────────────────────────────────────────────────
    function stepMap() {
        const wrap = el('div');
        const help = el('div', 'ti-help', `Found ${state.total.toLocaleString()} row${state.total === 1 ? '' : 's'}. Match your file's columns to the fields below.`);
        wrap.appendChild(help);

        const grid = el('div', 'ti-map-grid');
        const selects = {};
        FIELDS.forEach((f) => {
            const lab = el('label', 'ti-map-label');
            lab.innerHTML = esc(f.label) + (f.required ? ' <span class="ti-req">*</span>' : '');
            const sel = document.createElement('select');
            sel.className = 'ti-map-select';
            if (!f.required) sel.append(new Option('— none —', ''));
            state.columns.forEach((c, i) => sel.append(new Option(c || `Column ${i + 1}`, String(i))));
            const cur = state.mapping[f.key];
            sel.value = (cur === null || cur === undefined) ? '' : String(cur);
            selects[f.key] = sel;
            grid.append(lab, sel);
        });
        wrap.appendChild(grid);

        // Price mode: use recent-sales average instead of the Price column.
        const avgWrap = el('label', 'ti-check');
        const avg = document.createElement('input'); avg.type = 'checkbox'; avg.checked = (state.priceMode === 'avg');
        avgWrap.append(avg, el('span', null, ' Use the average of recent sales for price (ignore the Price column)'));
        wrap.appendChild(avgWrap);

        // Small sample preview to help mapping.
        if (state.sample.length) {
            const prev = el('div', 'ti-sample');
            const t = el('table', 'ti-table');
            const thead = el('tr');
            state.columns.forEach((c, i) => thead.append(el('th', null, c || `Col ${i + 1}`)));
            t.appendChild(thead);
            state.sample.slice(0, 6).forEach((r) => {
                const tr = el('tr');
                state.columns.forEach((_, i) => tr.append(el('td', null, r[i] != null ? String(r[i]) : '')));
                t.appendChild(tr);
            });
            prev.appendChild(t);
            wrap.appendChild(prev);
        }

        const msg = el('div', 'ti-msg');
        wrap.appendChild(msg);

        const back = button('Back', 'secondary');
        back.onclick = () => stepUpload();
        const go = button('Validate', 'trade-green');
        go.onclick = async () => {
            const mapping = {};
            FIELDS.forEach((f) => { const v = selects[f.key].value; mapping[f.key] = (v === '') ? null : parseInt(v, 10); });
            if (mapping.item_name === null) { msg.textContent = 'Map the Item Name column to continue.'; msg.classList.add('ti-err'); return; }
            state.mapping = mapping;
            state.priceMode = avg.checked ? 'avg' : '';
            try { localStorage.setItem(MAP_LS_KEY(kind), JSON.stringify({ sig: state.columns.join('|'), mapping })); } catch (e) { /* ignore */ }
            go.disabled = true; go.textContent = 'Validating…';
            try {
                const rep = await apiJson('POST', '/api/trading/import/validate',
                    { token: state.token, mapping, price_mode: state.priceMode });
                stepPreview(rep);
            } catch (e) {
                go.disabled = false; go.textContent = 'Validate';
                msg.textContent = e.message; msg.classList.add('ti-err');
            }
        };
        wrap.appendChild(rowButtons([back, go]));
        setBody(wrap);
    }

    // ── Step 3: preview + decisions ────────────────────────────────────────────
    function stepPreview(rep) {
        const wrap = el('div');
        const c = rep.counts;
        const isListings = (kind === 'listings');

        const summary = el('div', 'ti-summary');
        summary.innerHTML = `<strong class="ti-ok">${c.importable.toLocaleString()}</strong> can import`
            + (c.bad ? ` · <strong class="ti-bad">${c.bad.toLocaleString()}</strong> cannot` : '')
            + (c.duplicates ? ` · ${c.duplicates.toLocaleString()} duplicate${c.duplicates === 1 ? '' : 's'}` : '')
            + (isListings && c.owned_issues ? ` · ${c.owned_issues.toLocaleString()} you don't own enough of` : '');
        wrap.appendChild(summary);

        // Bad rows (cannot import).
        if (rep.bad.length) {
            const det = el('details', 'ti-bad-block');
            const sm = el('summary', null, `Rows that cannot import (${c.bad.toLocaleString()})`);
            det.appendChild(sm);
            const list = el('div', 'ti-bad-list');
            rep.bad.forEach((b) => {
                const name = b.raw.item_name || '(blank)';
                list.appendChild(el('div', 'ti-bad-row',
                    `Row ${b.row}: ${name} — ${b.errors.join('; ')}`));
            });
            if (rep.bad_truncated) list.appendChild(el('div', 'ti-note', '…more not shown.'));
            det.appendChild(list);
            const dl = button('Download these rows (CSV)', 'secondary');
            dl.onclick = () => downloadBadRows(rep.bad, kind);
            det.appendChild(dl);
            wrap.appendChild(det);
        }

        const decisions = { dupGlobal: null, ownedGlobal: null, dupOver: {}, ownedOver: {} };

        // Global duplicate handling (required when duplicates exist).
        let dupGlobalGroup = null;
        if (c.duplicates) {
            const blk = el('div', 'ti-global');
            blk.appendChild(el('div', 'ti-global-label', 'For every duplicate (same item + quality):'));
            dupGlobalGroup = radioGroup('ti-dup-global', [
                { value: 'overwrite', label: 'Overwrite all' },
                { value: 'new', label: 'Create new for all' },
                { value: 'skip', label: 'Skip all' },
            ], (v) => { decisions.dupGlobal = v; refreshImport(); });
            blk.appendChild(dupGlobalGroup);
            wrap.appendChild(blk);
        }
        // Global owned handling (listings only, required when issues exist).
        let ownedGlobalGroup = null;
        if (isListings && c.owned_issues) {
            const blk = el('div', 'ti-global');
            blk.appendChild(el('div', 'ti-global-label', "For items you don't own enough of:"));
            ownedGlobalGroup = radioGroup('ti-owned-global', [
                { value: 'override', label: 'List all anyway' },
                { value: 'skip', label: 'Skip all' },
            ], (v) => { decisions.ownedGlobal = v; refreshImport(); });
            blk.appendChild(ownedGlobalGroup);
            wrap.appendChild(blk);
        }

        // Per-row flagged tables (duplicates, then owned). Horizontal radios.
        const dupRows = rep.good.filter((g) => g.dup);
        const ownedRows = isListings ? rep.good.filter((g) => g.owned && g.owned.too_few) : [];

        if (dupRows.length) {
            wrap.appendChild(flaggedTable('Duplicates', dupRows, (g) => {
                const where = g.dup.source === 'existing' ? 'already in your list' : `same as row ${g.dup.first_row}`;
                return where;
            }, [
                { value: 'overwrite', label: 'Overwrite' },
                { value: 'new', label: 'Create new' },
                { value: 'skip', label: 'Skip' },
            ], (row, v) => { decisions.dupOver[row] = v; }));
        }
        if (ownedRows.length) {
            wrap.appendChild(flaggedTable('Not enough owned', ownedRows,
                (g) => `own ${g.owned.owned_qty}, listing ${g.owned.listing_qty}`, [
                    { value: 'override', label: 'List anyway' },
                    { value: 'skip', label: 'Skip' },
                ], (row, v) => { decisions.ownedOver[row] = v; }));
        }

        // Clean preview (sample of rows with no flags).
        const clean = rep.good.filter((g) => !g.dup && !(isListings && g.owned && g.owned.too_few));
        if (clean.length) {
            const det = el('details', 'ti-clean-block');
            det.open = !dupRows.length && !ownedRows.length;
            det.appendChild(el('summary', null, `Ready to import (${clean.length.toLocaleString()}${rep.good_truncated ? '+' : ''})`));
            det.appendChild(previewTable(clean.slice(0, 50)));
            if (clean.length > 50) det.appendChild(el('div', 'ti-note', `…and ${(clean.length - 50).toLocaleString()} more.`));
            wrap.appendChild(det);
        }

        const msg = el('div', 'ti-msg');
        wrap.appendChild(msg);

        const back = button('Back', 'secondary');
        back.onclick = () => stepMap();
        const cancel = button('Cancel', 'secondary');
        cancel.onclick = () => m.close();
        const imp = button(`Import ${c.importable.toLocaleString()}`, 'trade-green');

        function refreshImport() {
            const needDup = !!c.duplicates && !decisions.dupGlobal;
            const needOwned = isListings && !!c.owned_issues && !decisions.ownedGlobal;
            imp.disabled = needDup || needOwned || c.importable === 0;
            msg.textContent = (needDup || needOwned) ? 'Choose a handling option above to import.' : '';
            msg.classList.toggle('ti-err', false);
        }
        refreshImport();

        imp.onclick = async () => {
            imp.disabled = true; imp.textContent = 'Importing…';
            try {
                const res = await apiJson('POST', '/api/trading/import/commit', {
                    token: state.token, mapping: state.mapping, price_mode: state.priceMode,
                    dup_global: decisions.dupGlobal || '', owned_global: decisions.ownedGlobal || '',
                    dup_overrides: decisions.dupOver, owned_overrides: decisions.ownedOver,
                });
                m.close();
                const parts = [`Imported ${res.imported}`];
                if (res.updated) parts.push(`updated ${res.updated}`);
                if (res.skipped) parts.push(`skipped ${res.skipped}`);
                if (window._tradingPage) window._tradingPage._switchTab(kind);
                if (window.toast) window.toast(parts.join(' · '));
            } catch (e) {
                imp.disabled = false; imp.textContent = `Import ${c.importable.toLocaleString()}`;
                msg.textContent = e.message; msg.classList.add('ti-err');
            }
        };

        wrap.appendChild(rowButtons([back, cancel, imp]));
        setBody(wrap);
    }

    stepUpload();
}

// ── Shared render helpers ────────────────────────────────────────────────────
function rowButtons(btns) {
    const row = el('div', 'ti-actions');
    btns.forEach((b) => row.appendChild(b));
    return row;
}

function qualityLabel(q) {
    if (!q) return '';
    const map = { common: 'Normal', uncommon: 'Good', rare: 'Great', epic: 'Excellent',
        legendary: 'Perfect', ethereal: 'Eternal', fine: 'Fine' };
    return map[q] || q;
}

function previewTable(rows) {
    const t = el('table', 'ti-table');
    const h = el('tr');
    ['Item', 'Quality', 'Qty', 'Price', 'Notes'].forEach((c) => h.append(el('th', null, c)));
    t.appendChild(h);
    rows.forEach((g) => {
        const tr = el('tr');
        tr.append(el('td', null, g.item.name || pretty(g.item.slug)));
        tr.append(el('td', null, qualityLabel(g.item.quality)));
        tr.append(el('td', null, String(g.quantity)));
        tr.append(el('td', null, g.price == null ? 'negotiable' : `${g.price.toLocaleString()}g`));
        tr.append(el('td', null, g.notes || ''));
        t.appendChild(tr);
    });
    return t;
}

function flaggedTable(title, rows, whyFn, options, onPick) {
    const det = el('details', 'ti-flag-block');
    det.open = true;
    det.appendChild(el('summary', null, `${title} (${rows.length.toLocaleString()})`));
    const t = el('table', 'ti-table ti-flag-table');
    const h = el('tr');
    ['Item', 'Qty', 'Why', 'This row'].forEach((c) => h.append(el('th', null, c)));
    t.appendChild(h);
    rows.forEach((g, i) => {
        const tr = el('tr');
        const q = g.item.quality ? ` (${qualityLabel(g.item.quality)})` : '';
        tr.append(el('td', null, (g.item.name || pretty(g.item.slug)) + q));
        tr.append(el('td', null, String(g.quantity)));
        tr.append(el('td', 'ti-why', whyFn(g)));
        const cell = el('td');
        cell.appendChild(radioGroup(`${title}-${i}-${g.row}`, options, (v) => onPick(g.row, v)));
        tr.appendChild(cell);
        t.appendChild(tr);
    });
    det.appendChild(t);
    return det;
}

function downloadBadRows(bad, kind) {
    const rows = [['Item Name', 'Quality', 'Quantity', 'Price', 'Notes', 'Reason']];
    bad.forEach((b) => rows.push([
        b.raw.item_name || '', b.raw.quality || '', b.raw.quantity || '',
        b.raw.price || '', b.raw.notes || '', b.errors.join('; '),
    ]));
    const csv = rows.map((r) => r.map((c) => {
        const s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `walkscape-${kind}-skipped-rows.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

window.openTradeImport = openTradeImport;
