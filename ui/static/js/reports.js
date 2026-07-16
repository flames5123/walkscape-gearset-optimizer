import { formatFixed } from './utils/number-format.js';
/**
 * Admin Reports Page
 * 
 * Password-protected admin panel replicating Discord bot functionality:
 * - Bug report listing, screenshots, debug logs
 * - Session management (list, lookup, stats, active)
 * - Docker container logs
 * - Debug mode management
 */

const API = '/api/admin';
const COOKIE_NAME = 'admin_token';

// ============================================================================
// AUTH
// ============================================================================

function getToken() {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

function setToken(token) {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict`;
}

function clearToken() {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}

async function apiFetch(path, opts = {}) {
    const token = getToken();
    const headers = { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
        clearToken();
        location.reload();
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || err.message || 'Request failed');
    }
    return res;
}

async function apiJson(path, opts = {}) {
    const res = await apiFetch(path, opts);
    return res.json();
}

// ============================================================================
// INIT
// ============================================================================

let currentPanel = 'reports';
let currentReportId = null;

document.addEventListener('DOMContentLoaded', () => {
    const token = getToken();
    if (token) {
        verifyAndShow();
    }

    // Login
    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('logout-btn').addEventListener('click', () => { clearToken(); location.reload(); });

    // Nav
    document.getElementById('nav').addEventListener('click', e => {
        const btn = e.target.closest('button[data-panel]');
        if (!btn) return;
        switchPanel(btn.dataset.panel);
    });

    // Lightbox
    document.getElementById('lightbox').addEventListener('click', () => {
        document.getElementById('lightbox').classList.remove('visible');
    });

    // Review modal
    document.getElementById('review-cancel').addEventListener('click', () => {
        document.getElementById('review-modal').classList.remove('visible');
    });
    document.getElementById('review-submit').addEventListener('click', submitReview);
});

async function doLogin() {
    const pw = document.getElementById('login-password').value;
    if (!pw) return;
    try {
        const res = await fetch(`${API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        if (!res.ok) {
            document.getElementById('login-error').style.display = 'block';
            return;
        }
        const data = await res.json();
        setToken(data.token);
        verifyAndShow();
    } catch {
        document.getElementById('login-error').style.display = 'block';
    }
}

async function verifyAndShow() {
    try {
        await apiJson('/verify');
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app').classList.add('visible');
        loadPanel(currentPanel);
    } catch {
        clearToken();
        document.getElementById('login-overlay').style.display = 'flex';
    }
}

function switchPanel(name) {
    currentPanel = name;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
    loadPanel(name);
}

function loadPanel(name) {
    const loaders = { reports: loadReports, sessions: loadSessions, snapshots: loadSnapshots, logs: loadLogs, debug: loadDebug, flags: loadFlags };
    if (loaders[name]) loaders[name]();
}

function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function timeAgo(iso) {
    if (!iso) return '?';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}


// ============================================================================
// REPORTS PANEL
// ============================================================================

let reportsFilter = 'unreviewed';

async function loadReports() {
    currentReportId = null;
    const panel = document.getElementById('panel-reports');
    panel.innerHTML = '<div class="loading">Loading reports...</div>';

    try {
        const data = await apiJson(`/reports?status=${reportsFilter}`);
        renderReportsList(data.reports, data.stats);
    } catch (e) {
        panel.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

function renderReportsList(reports, stats) {
    const panel = document.getElementById('panel-reports');

    let statsHtml = '';
    if (stats) {
        statsHtml = `<div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Total</div></div>
            <div class="stat-card"><div class="stat-value">${stats.unreviewed}</div><div class="stat-label">Unreviewed</div></div>
            <div class="stat-card"><div class="stat-value">${stats.reviewed}</div><div class="stat-label">Reviewed</div></div>
        </div>`;
    }

    const filterHtml = `<div class="filter-bar">
        <select id="reports-filter">
            <option value="unreviewed" ${reportsFilter === 'unreviewed' ? 'selected' : ''}>Unreviewed</option>
            <option value="reviewed" ${reportsFilter === 'reviewed' ? 'selected' : ''}>Reviewed</option>
            <option value="all" ${reportsFilter === 'all' ? 'selected' : ''}>All</option>
        </select>
        <span style="color:var(--text-muted);font-size:0.8rem">${reports.length} report(s)</span>
    </div>`;

    let listHtml = '';
    if (!reports.length) {
        listHtml = '<div class="card" style="text-align:center;color:var(--text-muted)">No reports found</div>';
    } else {
        for (const r of reports) {
            const badge = r.reviewed
                ? `<span class="badge badge-reviewed">Reviewed</span>`
                : `<span class="badge badge-pending">Pending</span>`;
            const desc = escHtml(r.description.length > 120 ? r.description.slice(0, 120) + '...' : r.description);
            const hasScreenshots = r.screenshots_json ? '📸' : '';
            listHtml += `<div class="report-item" data-id="${r.id}">
                <div class="report-desc">${badge} ${hasScreenshots} ${desc}</div>
                <div class="report-meta">
                    <span class="report-id">${r.id.slice(0, 8)}...</span>
                    <span>${escHtml(r.app_version)}</span>
                    <span>${timeAgo(r.timestamp)}</span>
                    <span>${r.timestamp ? r.timestamp.slice(0, 19) : ''}</span>
                    ${r.reviewed_by ? `<span>by ${escHtml(r.reviewed_by)}</span>` : ''}
                </div>
            </div>`;
        }
    }

    panel.innerHTML = statsHtml + filterHtml + listHtml;

    // Events
    document.getElementById('reports-filter').addEventListener('change', e => {
        reportsFilter = e.target.value;
        loadReports();
    });
    panel.querySelectorAll('.report-item').forEach(el => {
        el.addEventListener('click', () => loadReportDetail(el.dataset.id));
    });
}

async function loadReportDetail(reportId) {
    currentReportId = reportId;
    const panel = document.getElementById('panel-reports');
    panel.innerHTML = '<div class="loading">Loading report...</div>';

    try {
        const data = await apiJson(`/reports/${reportId}`);
        renderReportDetail(data);
    } catch (e) {
        panel.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

function renderReportDetail(data) {
    const panel = document.getElementById('panel-reports');
    const r = data.report;
    const session = data.snapshot_session;
    const gearSets = data.snapshot_gear_sets || [];

    let browserInfo = {};
    try { browserInfo = typeof r.browser_info === 'string' ? JSON.parse(r.browser_info) : r.browser_info; } catch { }

    const badge = r.reviewed ? '<span class="badge badge-reviewed">Reviewed</span>' : '<span class="badge badge-pending">Pending</span>';

    // Character info
    let charHtml = '<span style="color:var(--text-muted)">No character data</span>';
    if (session && session.character_config) {
        const c = session.character_config;
        charHtml = `<div class="detail-grid">
            <div class="detail-field"><label>Name</label><span>${escHtml(c.name)}</span></div>
            <div class="detail-field"><label>Steps</label><span>${(c.steps || 0).toLocaleString()}</span></div>
            <div class="detail-field"><label>AP</label><span>${c.achievement_points || 0}</span></div>
            <div class="detail-field"><label>Coins</label><span>${(c.coins || 0).toLocaleString()}</span></div>
        </div>`;
        if (c.skills && Object.keys(c.skills).length) {
            const skills = Object.entries(c.skills).sort((a, b) => b[1] - a[1]).slice(0, 12);
            charHtml += `<div style="margin-top:0.5rem"><label style="font-size:0.7rem;color:var(--text-muted)">Skills</label><div class="detail-grid">`;
            for (const [k, v] of skills) {
                charHtml += `<div class="detail-field"><label>${escHtml(k)}</label><span>${v}</span></div>`;
            }
            charHtml += '</div></div>';
        }
    }

    // Gear sets
    let gearHtml = '';
    if (gearSets.length) {
        gearHtml = `<div class="detail-section"><h4>Gear Sets (${gearSets.length})</h4><div style="font-size:0.85rem">`;
        for (const gs of gearSets.slice(0, 10)) {
            gearHtml += `<div style="padding:0.25rem 0;color:var(--text-secondary)">• ${escHtml(gs.name)}</div>`;
        }
        if (gearSets.length > 10) gearHtml += `<div style="color:var(--text-muted)">...and ${gearSets.length - 10} more</div>`;
        gearHtml += '</div></div>';
    }

    // Screenshots
    let screenshotsHtml = '';
    if (data.screenshots && data.screenshots.length) {
        screenshotsHtml = `<div class="detail-section"><h4>Screenshots</h4><div class="screenshots-grid">`;
        for (const s of data.screenshots) {
            screenshotsHtml += `<div class="screenshot-card">
                <img src="${API}/reports/${r.id}/screenshot/${encodeURIComponent(s.name)}?token=${encodeURIComponent(getToken())}" 
                     alt="${escHtml(s.name)}" loading="lazy" onclick="openLightbox(this.src)">
                <div class="screenshot-label">${escHtml(s.name)} (${formatFixed((s.size / 1024), 1)} KB)</div>
            </div>`;
        }
        screenshotsHtml += '</div></div>';
    }

    // Debug log
    let debugLogHtml = '';
    if (data.has_debug_log) {
        debugLogHtml = `<div class="detail-section"><h4>Debug Log</h4>
            <div class="btn-group" style="margin-bottom:0.5rem">
                <button class="btn btn-outline" id="load-debug-log">Load Debug Log</button>
                <a class="btn btn-outline" href="${API}/reports/${r.id}/debug-log?token=${encodeURIComponent(getToken())}" download="debug_log.txt">Download</a>
            </div>
            <div id="debug-log-content"></div>
        </div>`;
    }

    // Server logs
    let serverLogHtml = '';
    if (data.has_server_logs) {
        serverLogHtml = `<div class="detail-section"><h4>Server Logs</h4>
            <div class="btn-group" style="margin-bottom:0.5rem">
                <button class="btn btn-outline" id="load-server-log">Load Server Logs</button>
                <a class="btn btn-outline" href="${API}/reports/${r.id}/server-logs?token=${encodeURIComponent(getToken())}" download="server_logs.txt">Download</a>
            </div>
            <div id="server-log-content"></div>
        </div>`;
    }

    // Actions
    let actionsHtml = '<div class="btn-group">';
    if (!r.reviewed) {
        actionsHtml += `<button class="btn btn-success" id="btn-mark-reviewed">✅ Mark Reviewed</button>`;
    }
    actionsHtml += `<button class="btn btn-outline" id="btn-export-sql">📤 Export SQL</button>`;
    actionsHtml += `<button class="btn btn-danger" id="btn-delete-screenshots">🗑️ Delete Screenshots</button>`;
    actionsHtml += '</div>';

    panel.innerHTML = `
        <button class="back-btn" id="back-to-list">← Back to reports</button>
        <div class="card">
            <div class="card-header"><h3>${badge} Report ${r.id.slice(0, 8)}...</h3></div>
            <div class="detail-section"><h4>Description</h4><div style="white-space:pre-wrap;font-size:0.9rem">${escHtml(r.description)}</div></div>
            <div class="detail-section"><h4>Info</h4>
                <div class="detail-grid">
                    <div class="detail-field"><label>Report ID</label><span class="mono">${r.id}</span></div>
                    <div class="detail-field"><label>Original Session</label><span class="mono">${r.original_session_uuid}</span></div>
                    <div class="detail-field"><label>Snapshot Session</label><span class="mono">${r.snapshot_session_uuid}</span></div>
                    <div class="detail-field"><label>App Version</label><span>${escHtml(r.app_version)}</span></div>
                    <div class="detail-field"><label>Browser</label><span>${escHtml(browserInfo.name || '?')} ${escHtml(browserInfo.version || '')}</span></div>
                    <div class="detail-field"><label>Platform</label><span>${escHtml(browserInfo.platform || '?')}</span></div>
                    <div class="detail-field"><label>Screen</label><span>${escHtml(browserInfo.screenResolution || '?')}</span></div>
                    <div class="detail-field"><label>Viewport</label><span>${escHtml(browserInfo.viewportSize || '?')}</span></div>
                    <div class="detail-field"><label>Submitted</label><span>${r.timestamp ? r.timestamp.slice(0, 19) : '?'}</span></div>
                    ${r.reviewed ? `<div class="detail-field"><label>Reviewed By</label><span>${escHtml(r.reviewed_by)}</span></div>
                    <div class="detail-field"><label>Reviewed At</label><span>${r.reviewed_at ? r.reviewed_at.slice(0, 19) : '?'}</span></div>` : ''}
                    ${r.notes ? `<div class="detail-field" style="grid-column:1/-1"><label>Notes</label><span>${escHtml(r.notes)}</span></div>` : ''}
                </div>
            </div>
            <div class="detail-section"><h4>Character</h4>${charHtml}</div>
            ${gearHtml}
            ${screenshotsHtml}
            ${debugLogHtml}
            ${serverLogHtml}
            ${actionsHtml}
        </div>`;

    // Events
    document.getElementById('back-to-list').addEventListener('click', loadReports);

    const markBtn = document.getElementById('btn-mark-reviewed');
    if (markBtn) markBtn.addEventListener('click', () => openReviewModal(r.id));

    document.getElementById('btn-export-sql').addEventListener('click', () => exportReportSql(r.id));
    document.getElementById('btn-delete-screenshots').addEventListener('click', () => deleteReportScreenshots(r.id));

    const debugBtn = document.getElementById('load-debug-log');
    if (debugBtn) debugBtn.addEventListener('click', () => loadDebugLog(r.id));

    const serverLogBtn = document.getElementById('load-server-log');
    if (serverLogBtn) serverLogBtn.addEventListener('click', () => loadServerLog(r.id));
}

function openLightbox(src) {
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox').classList.add('visible');
}

function openReviewModal(reportId) {
    currentReportId = reportId;
    document.getElementById('reviewer-name').value = '';
    document.getElementById('review-notes').value = '';
    document.getElementById('review-modal').classList.add('visible');
}

async function submitReview() {
    const name = document.getElementById('reviewer-name').value.trim();
    if (!name) return;
    const notes = document.getElementById('review-notes').value.trim();
    try {
        await apiJson(`/reports/${currentReportId}/review`, {
            method: 'POST',
            body: { reviewed_by: name, notes: notes || null }
        });
        document.getElementById('review-modal').classList.remove('visible');
        toast('Report marked as reviewed');
        loadReportDetail(currentReportId);
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function exportReportSql(reportId) {
    try {
        const res = await apiFetch(`/reports/${reportId}/export-sql`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${reportId.slice(0, 8)}.sql`;
        a.click();
        URL.revokeObjectURL(url);
        toast('SQL exported');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteReportScreenshots(reportId) {
    if (!confirm('Delete all screenshots for this report?')) return;
    try {
        await apiJson(`/reports/${reportId}/screenshots`, { method: 'DELETE' });
        toast('Screenshots deleted');
        loadReportDetail(reportId);
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadDebugLog(reportId) {
    const container = document.getElementById('debug-log-content');
    container.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const res = await apiFetch(`/reports/${reportId}/debug-log`);
        const text = await res.text();
        container.innerHTML = `<div class="debug-log-viewer">${escHtml(text)}</div>`;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--accent)">${escHtml(e.message)}</div>`;
    }
}

async function loadServerLog(reportId) {
    const container = document.getElementById('server-log-content');
    container.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const res = await apiFetch(`/reports/${reportId}/server-logs`);
        const text = await res.text();
        container.innerHTML = `<div class="debug-log-viewer">${escHtml(text)}</div>`;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--accent)">${escHtml(e.message)}</div>`;
    }
}


// ============================================================================
// SESSIONS PANEL
// ============================================================================

let sessionsPage = 0;
let sessionsSearch = '';
let sessionsView = 'list'; // 'list' | 'stats' | 'active' | 'lookup'
let activeHours = 24;

async function loadSessions() {
    sessionsView = 'list';
    renderSessionsNav();
    loadSessionsList();
}

function renderSessionsNav() {
    const panel = document.getElementById('panel-sessions');
    // Keep nav at top, content below
    let nav = panel.querySelector('.sessions-nav');
    if (!nav) {
        panel.innerHTML = `<div class="sessions-nav filter-bar">
            <button class="btn btn-outline active" data-view="list">Characters</button>
            <button class="btn btn-outline" data-view="stats">Stats</button>
            <button class="btn btn-outline" data-view="active">Active</button>
            <button class="btn btn-outline" data-view="lookup">Lookup</button>
        </div><div id="sessions-content"></div>`;
        panel.querySelector('.sessions-nav').addEventListener('click', e => {
            const btn = e.target.closest('button[data-view]');
            if (!btn) return;
            sessionsView = btn.dataset.view;
            panel.querySelectorAll('.sessions-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === sessionsView));
            const loaders = { list: loadSessionsList, stats: loadSessionsStats, active: loadActiveSessions, lookup: renderLookupForm };
            loaders[sessionsView]();
        });
    }
}

async function loadSessionsList() {
    const content = document.getElementById('sessions-content');
    content.innerHTML = '<div class="loading">Loading...</div>';
    try {
        const data = await apiJson(`/sessions/list?page=${sessionsPage}&search=${encodeURIComponent(sessionsSearch)}`);
        renderSessionsList(data);
    } catch (e) {
        content.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

function renderSessionsList(data) {
    const content = document.getElementById('sessions-content');
    const { characters, total, page, pages } = data;

    let html = `<div class="filter-bar" style="margin-top:0.75rem">
        <input type="text" id="session-search" placeholder="Search by name..." value="${escHtml(sessionsSearch)}">
        <span style="color:var(--text-muted);font-size:0.8rem">${total} total</span>
    </div>`;

    if (!characters.length) {
        html += '<div class="card" style="text-align:center;color:var(--text-muted)">No characters found</div>';
    } else {
        html += '<table class="sessions-table"><thead><tr><th>Name</th><th>Steps</th><th>Last Active</th><th>UUID</th></tr></thead><tbody>';
        for (const c of characters) {
            html += `<tr>
                <td>${escHtml(c.name || 'Unknown')}</td>
                <td>${(c.steps || 0).toLocaleString()}</td>
                <td>${c.last_updated ? c.last_updated.slice(0, 19) : '?'}</td>
                <td><span class="uuid" title="Click to copy" data-uuid="${c.uuid}">${c.uuid.slice(0, 8)}...</span></td>
            </tr>`;
        }
        html += '</tbody></table>';
    }

    if (pages > 1) {
        html += `<div class="pagination">
            <button class="btn btn-outline" id="sessions-prev" ${page <= 0 ? 'disabled' : ''}>◀ Prev</button>
            <span class="page-info">Page ${page + 1} of ${pages}</span>
            <button class="btn btn-outline" id="sessions-next" ${page >= pages - 1 ? 'disabled' : ''}>Next ▶</button>
        </div>`;
    }

    content.innerHTML = html;

    // Events
    document.getElementById('session-search').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            sessionsSearch = e.target.value;
            sessionsPage = 0;
            loadSessionsList();
        }
    });
    const prev = document.getElementById('sessions-prev');
    const next = document.getElementById('sessions-next');
    if (prev) prev.addEventListener('click', () => { sessionsPage--; loadSessionsList(); });
    if (next) next.addEventListener('click', () => { sessionsPage++; loadSessionsList(); });

    content.querySelectorAll('.uuid').forEach(el => {
        el.addEventListener('click', () => {
            navigator.clipboard.writeText(el.dataset.uuid);
            toast('UUID copied');
        });
    });
}

async function loadSessionsStats() {
    const content = document.getElementById('sessions-content');
    content.innerHTML = '<div class="loading">Loading stats...</div>';
    try {
        const stats = await apiJson('/sessions/stats');
        content.innerHTML = `<div class="stats-grid" style="margin-top:0.75rem">
            <div class="stat-card"><div class="stat-value">${stats.total_sessions}</div><div class="stat-label">Total Sessions</div></div>
            <div class="stat-card"><div class="stat-value">${stats.sessions_with_characters}</div><div class="stat-label">With Characters</div></div>
            <div class="stat-card"><div class="stat-value">${stats.total_gear_sets}</div><div class="stat-label">Gear Sets</div></div>
            <div class="stat-card"><div class="stat-value">${stats.total_bug_reports}</div><div class="stat-label">Bug Reports</div></div>
            <div class="stat-card"><div class="stat-value">${stats.unreviewed_bug_reports}</div><div class="stat-label">Unreviewed</div></div>
            <div class="stat-card"><div class="stat-value">${stats.active_24h}</div><div class="stat-label">Active 24h</div></div>
            <div class="stat-card"><div class="stat-value">${stats.active_7d}</div><div class="stat-label">Active 7d</div></div>
        </div>
        ${stats.top_5_recent && stats.top_5_recent.length ? `<div class="card"><div class="card-header"><h3>Recently Active</h3></div>
            <table class="sessions-table"><thead><tr><th>Name</th><th>Steps</th><th>Last Active</th></tr></thead><tbody>
            ${stats.top_5_recent.map(s => `<tr><td>${escHtml(s.name || 'Anonymous')}</td><td>${(s.steps || 0).toLocaleString()}</td><td>${s.last_updated ? s.last_updated.slice(0, 19) : '?'}</td></tr>`).join('')}
            </tbody></table></div>` : ''}`;
    } catch (e) {
        content.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

async function loadActiveSessions() {
    const content = document.getElementById('sessions-content');
    content.innerHTML = '<div class="loading">Loading active sessions...</div>';
    try {
        const data = await apiJson(`/sessions/active?hours=${activeHours}&page=0`);
        let html = `<div class="filter-bar" style="margin-top:0.75rem">
            <label style="font-size:0.8rem;color:var(--text-muted)">Hours:</label>
            <select id="active-hours">
                ${[1, 6, 12, 24, 48, 168].map(h => `<option value="${h}" ${h === activeHours ? 'selected' : ''}>${h}h</option>`).join('')}
            </select>
            <span style="color:var(--text-muted);font-size:0.8rem">${data.total} session(s)</span>
        </div>`;

        if (data.sessions.length) {
            html += '<table class="sessions-table"><thead><tr><th>Name</th><th>Steps</th><th>Last Active</th><th>UUID</th></tr></thead><tbody>';
            for (const s of data.sessions) {
                html += `<tr>
                    <td>${escHtml(s.name || 'Anonymous')}</td>
                    <td>${(s.steps || 0).toLocaleString()}</td>
                    <td>${s.last_updated ? s.last_updated.slice(0, 19) : '?'}</td>
                    <td><span class="uuid" data-uuid="${s.uuid}">${s.uuid.slice(0, 8)}...</span></td>
                </tr>`;
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="card" style="text-align:center;color:var(--text-muted)">No active sessions</div>';
        }

        content.innerHTML = html;
        document.getElementById('active-hours').addEventListener('change', e => {
            activeHours = parseInt(e.target.value);
            loadActiveSessions();
        });
        content.querySelectorAll('.uuid').forEach(el => {
            el.addEventListener('click', () => { navigator.clipboard.writeText(el.dataset.uuid); toast('UUID copied'); });
        });
    } catch (e) {
        content.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

function renderLookupForm() {
    const content = document.getElementById('sessions-content');
    content.innerHTML = `<div style="margin-top:0.75rem">
        <div class="filter-bar">
            <input type="text" id="lookup-uuid" placeholder="Session UUID" style="flex:1;min-width:250px">
            <button class="btn btn-primary" id="lookup-btn">Lookup</button>
        </div>
        <div id="lookup-result"></div>
    </div>`;
    document.getElementById('lookup-btn').addEventListener('click', doLookup);
    document.getElementById('lookup-uuid').addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });
}

async function doLookup() {
    const uuid = document.getElementById('lookup-uuid').value.trim();
    if (!uuid) return;
    const result = document.getElementById('lookup-result');
    result.innerHTML = '<div class="loading">Looking up...</div>';
    try {
        const data = await apiJson(`/sessions/lookup/${encodeURIComponent(uuid)}`);
        if (!data.session) {
            result.innerHTML = '<div class="card" style="color:var(--accent)">Session not found</div>';
            return;
        }
        const s = data.session;
        const c = s.character_config || {};
        const gs = data.gear_sets || [];
        let html = `<div class="card">
            <div class="card-header"><h3>${escHtml(c.name || 'Unknown')}</h3></div>
            <div class="detail-grid">
                <div class="detail-field"><label>UUID</label><span class="mono">${s.uuid}</span></div>
                <div class="detail-field"><label>Steps</label><span>${(c.steps || 0).toLocaleString()}</span></div>
                <div class="detail-field"><label>AP</label><span>${c.achievement_points || 0}</span></div>
                <div class="detail-field"><label>Coins</label><span>${(c.coins || 0).toLocaleString()}</span></div>
                <div class="detail-field"><label>Last Updated</label><span>${s.last_updated ? s.last_updated.slice(0, 19) : '?'}</span></div>
                <div class="detail-field"><label>Gear Sets</label><span>${gs.length}</span></div>
            </div>`;
        if (c.skills && Object.keys(c.skills).length) {
            const skills = Object.entries(c.skills).sort((a, b) => b[1] - a[1]);
            html += `<div style="margin-top:0.75rem"><h4 style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem">Skills</h4><div class="detail-grid">`;
            for (const [k, v] of skills) {
                html += `<div class="detail-field"><label>${escHtml(k)}</label><span>${v}</span></div>`;
            }
            html += '</div></div>';
        }
        if (gs.length) {
            html += `<div style="margin-top:0.75rem"><h4 style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem">Gear Sets</h4>`;
            for (const g of gs) html += `<div style="padding:0.2rem 0;font-size:0.85rem;color:var(--text-secondary)">• ${escHtml(g.name)}</div>`;
            html += '</div>';
        }
        html += `<div style="margin-top:0.75rem" class="btn-group">
            <button class="btn btn-primary" id="snapshot-lookup-btn">📸 Make Snapshot</button>
            <button class="btn btn-outline" id="export-lookup-sql">📤 Export SQL</button>
        </div>`;
        html += '</div>';
        result.innerHTML = html;
        document.getElementById('export-lookup-sql').addEventListener('click', () => exportSessionSql(uuid));
        document.getElementById('snapshot-lookup-btn').addEventListener('click', () => createSnapshot(uuid));
    } catch (e) {
        result.innerHTML = `<div class="card" style="color:var(--accent)">${escHtml(e.message)}</div>`;
    }
}

async function exportSessionSql(uuid) {
    try {
        const res = await apiFetch(`/sessions/export/${encodeURIComponent(uuid)}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${uuid.slice(0, 8)}.sql`;
        a.click();
        URL.revokeObjectURL(url);
        toast('SQL exported');
    } catch (e) {
        toast(e.message, 'error');
    }
}

// ============================================================================
// LOGS PANEL
// ============================================================================

let logLines = 500;

async function loadLogs() {
    const panel = document.getElementById('panel-logs');
    panel.innerHTML = `<div class="filter-bar">
        <label style="font-size:0.8rem;color:var(--text-muted)">Lines:</label>
        <select id="log-lines">
            ${[100, 500, 1000, 5000, 10000].map(n => `<option value="${n}" ${n === logLines ? 'selected' : ''}>${n.toLocaleString()}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="fetch-logs-btn">Fetch Logs</button>
        <button class="btn btn-outline" id="download-logs-btn">Download Full</button>
    </div>
    <div id="logs-content" class="log-viewer" style="margin-top:0.5rem">Click "Fetch Logs" to load container logs.</div>`;

    document.getElementById('log-lines').addEventListener('change', e => { logLines = parseInt(e.target.value); });
    document.getElementById('fetch-logs-btn').addEventListener('click', fetchLogs);
    document.getElementById('download-logs-btn').addEventListener('click', downloadLogs);
}

async function fetchLogs() {
    const content = document.getElementById('logs-content');
    content.textContent = 'Loading logs...';
    try {
        const res = await apiFetch(`/logs?lines=${logLines}`);
        const text = await res.text();
        content.textContent = text || '(empty)';
        content.scrollTop = content.scrollHeight;
    } catch (e) {
        content.textContent = `Error: ${e.message}`;
    }
}

async function downloadLogs() {
    try {
        const res = await apiFetch('/logs?lines=100000');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `walkscape_logs_${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        toast(e.message, 'error');
    }
}

// ============================================================================
// DEBUG PANEL
// ============================================================================

async function loadDebug() {
    const panel = document.getElementById('panel-debug');
    panel.innerHTML = '<div class="loading">Loading debug sessions...</div>';
    try {
        const data = await apiJson('/debug/list');
        let html = `<div class="card">
            <div class="card-header"><h3>🐛 Debug Sessions (${data.sessions.length})</h3></div>
            <div class="filter-bar">
                <input type="text" id="debug-uuid" placeholder="Session UUID">
                <button class="btn btn-success" id="debug-enable-btn">Enable</button>
                <button class="btn btn-outline" id="debug-disable-btn">Disable</button>
            </div>`;

        if (data.sessions.length) {
            html += '<table class="sessions-table"><thead><tr><th>Character</th><th>UUID</th><th>Enabled At</th><th>Enabled By</th><th>Action</th></tr></thead><tbody>';
            for (const s of data.sessions) {
                html += `<tr>
                    <td>${escHtml(s.character_name || 'Unknown')}</td>
                    <td><span class="uuid" data-uuid="${s.session_uuid}">${s.session_uuid.slice(0, 12)}...</span></td>
                    <td>${s.enabled_at ? s.enabled_at.slice(0, 19) : '?'}</td>
                    <td>${escHtml(s.enabled_by)}</td>
                    <td><button class="btn btn-outline" data-disable="${s.session_uuid}" style="font-size:0.75rem;padding:0.2rem 0.5rem">Disable</button></td>
                </tr>`;
            }
            html += '</tbody></table>';
        } else {
            html += '<div style="color:var(--text-muted);padding:0.5rem">No debug sessions active</div>';
        }
        html += '</div>';

        panel.innerHTML = html;

        // Events
        document.getElementById('debug-enable-btn').addEventListener('click', async () => {
            const uuid = document.getElementById('debug-uuid').value.trim();
            if (!uuid) return;
            try {
                await apiJson('/debug/enable', { method: 'POST', body: { uuid } });
                toast('Debug enabled');
                loadDebug();
            } catch (e) { toast(e.message, 'error'); }
        });
        document.getElementById('debug-disable-btn').addEventListener('click', async () => {
            const uuid = document.getElementById('debug-uuid').value.trim();
            if (!uuid) return;
            try {
                await apiJson('/debug/disable', { method: 'POST', body: { uuid } });
                toast('Debug disabled');
                loadDebug();
            } catch (e) { toast(e.message, 'error'); }
        });
        panel.querySelectorAll('[data-disable]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await apiJson('/debug/disable', { method: 'POST', body: { uuid: btn.dataset.disable } });
                    toast('Debug disabled');
                    loadDebug();
                } catch (e) { toast(e.message, 'error'); }
            });
        });
        panel.querySelectorAll('.uuid').forEach(el => {
            el.addEventListener('click', () => { navigator.clipboard.writeText(el.dataset.uuid); toast('UUID copied'); });
        });
    } catch (e) {
        panel.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}


// ============================================================================
// FEATURE FLAGS
// ============================================================================

let flagsFeature = 'debug';

async function loadFlags() {
    const panel = document.getElementById('panel-flags');
    panel.innerHTML = '<div class="loading">Loading feature flags...</div>';
    try {
        const data = await apiJson(`/feature-flags/${flagsFeature}`);
        let html = `<div class="card">
            <div class="card-header"><h3>🚩 Feature Flags</h3></div>
            <div class="filter-bar">
                <select id="flags-feature-select">
                    <option value="debug"${flagsFeature === 'debug' ? ' selected' : ''}>debug</option>
                    <option value="travel"${flagsFeature === 'travel' ? ' selected' : ''}>travel</option>
                    <option value="generic"${flagsFeature === 'generic' ? ' selected' : ''}>generic</option>
                </select>
                <input type="text" id="flags-uuid" placeholder="Session UUID to enable">
                <button class="btn btn-success" id="flags-enable-btn">Enable</button>
            </div>`;

        if (data.sessions.length) {
            html += '<table class="sessions-table"><thead><tr><th>Character</th><th>UUID</th><th>Enabled At</th><th>Enabled By</th><th>Action</th></tr></thead><tbody>';
            for (const s of data.sessions) {
                const isHardcoded = s.enabled_by === 'hardcoded';
                html += `<tr>
                    <td>${escHtml(s.character_name || 'Unknown')}</td>
                    <td><span class="uuid" data-uuid="${s.session_uuid}">${s.session_uuid.slice(0, 12)}...</span></td>
                    <td>${s.enabled_at === 'always' ? '<span style="color:var(--warning)">(hardcoded)</span>' : (s.enabled_at ? s.enabled_at.slice(0, 19) : '?')}</td>
                    <td>${escHtml(s.enabled_by)}</td>
                    <td>${isHardcoded ? '<span style="color:var(--text-muted);font-size:0.75rem">(hardcoded)</span>' : `<button class="btn btn-outline" data-flag-disable="${s.session_uuid}" style="font-size:0.75rem;padding:0.2rem 0.5rem">Disable</button>`}</td>
                </tr>`;
            }
            html += '</tbody></table>';
        } else {
            html += '<div style="color:var(--text-muted);padding:0.5rem">No sessions with this feature enabled</div>';
        }
        html += '</div>';

        panel.innerHTML = html;

        // Feature dropdown change
        document.getElementById('flags-feature-select').addEventListener('change', (e) => {
            flagsFeature = e.target.value;
            loadFlags();
        });

        // Enable button
        document.getElementById('flags-enable-btn').addEventListener('click', async () => {
            const uuid = document.getElementById('flags-uuid').value.trim();
            if (!uuid) return;
            try {
                await apiJson(`/feature-flags/${flagsFeature}/enable`, { method: 'POST', body: { uuid } });
                toast(`${flagsFeature} enabled`);
                loadFlags();
            } catch (e) { toast(e.message, 'error'); }
        });

        // Disable buttons
        panel.querySelectorAll('[data-flag-disable]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await apiJson(`/feature-flags/${flagsFeature}/disable`, { method: 'POST', body: { uuid: btn.dataset.flagDisable } });
                    toast(`${flagsFeature} disabled`);
                    loadFlags();
                } catch (e) { toast(e.message, 'error'); }
            });
        });

        // UUID copy
        panel.querySelectorAll('.uuid').forEach(el => {
            el.addEventListener('click', () => { navigator.clipboard.writeText(el.dataset.uuid); toast('UUID copied'); });
        });
    } catch (e) {
        panel.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}


// ============================================================================
// SNAPSHOTS
// ============================================================================

async function createSnapshot(uuid, description) {
    const desc = description || prompt('Snapshot description (optional):') || '';
    try {
        const result = await apiJson('/snapshots', {
            method: 'POST',
            body: { uuid, description: desc }
        });
        toast(`Snapshot created: ${result.snapshot_session_uuid.slice(0, 8)}...`);
        // If we're on the snapshots panel, refresh it
        if (currentPanel === 'snapshots') loadSnapshots();
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadSnapshots() {
    const panel = document.getElementById('panel-snapshots');
    panel.innerHTML = '<div class="loading">Loading snapshots...</div>';
    try {
        const data = await apiJson('/snapshots');
        renderSnapshotsList(data.snapshots);
    } catch (e) {
        panel.innerHTML = `<div class="card">Error: ${escHtml(e.message)}</div>`;
    }
}

function renderSnapshotsList(snapshots) {
    const panel = document.getElementById('panel-snapshots');

    let html = `<div class="filter-bar">
        <span style="color:var(--text-muted);font-size:0.85rem">${snapshots.length} snapshot(s)</span>
        <div style="margin-left:auto">
            <input type="text" id="snapshot-uuid-input" placeholder="Session UUID" style="width:260px">
            <button class="btn btn-primary" id="snapshot-create-btn">📸 New Snapshot</button>
        </div>
    </div>`;

    if (!snapshots.length) {
        html += '<div class="card" style="text-align:center;color:var(--text-muted)">No snapshots yet</div>';
    } else {
        for (const s of snapshots) {
            const origName = s.original_session_uuid_name || 'Unknown';
            const snapName = s.snapshot_session_uuid_name || origName;
            html += `<div class="card" style="margin-bottom:0.75rem">
                <div class="card-header">
                    <h3 style="font-size:0.9rem">${escHtml(snapName)} — ${escHtml(s.description || 'No description')}</h3>
                    <span style="font-size:0.75rem;color:var(--text-muted)">${timeAgo(s.created_at)}</span>
                </div>
                <div class="detail-grid" style="margin-bottom:0.5rem">
                    <div class="detail-field">
                        <label>Original Session</label>
                        <span class="mono" style="font-size:0.7rem">${s.original_session_uuid}</span>
                        <div style="font-size:0.8rem;color:var(--text-secondary)">${escHtml(origName)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Snapshot Session</label>
                        <span class="mono" style="font-size:0.7rem">${s.snapshot_session_uuid}</span>
                    </div>
                    <div class="detail-field">
                        <label>Created</label>
                        <span>${s.created_at ? s.created_at.slice(0, 19) : '?'}</span>
                    </div>
                    <div class="detail-field">
                        <label>Created By</label>
                        <span>${escHtml(s.created_by)}</span>
                    </div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-outline" onclick="exportSnapshotSql('${s.id}')">📤 Export SQL</button>
                    <button class="btn btn-danger" onclick="deleteSnapshot('${s.id}')">🗑️ Delete</button>
                </div>
            </div>`;
        }
    }

    panel.innerHTML = html;

    document.getElementById('snapshot-create-btn').addEventListener('click', () => {
        const uuid = document.getElementById('snapshot-uuid-input').value.trim();
        if (!uuid) { toast('Enter a session UUID', 'error'); return; }
        createSnapshot(uuid);
    });
}

async function exportSnapshotSql(snapshotId) {
    try {
        const res = await apiFetch(`/snapshots/${snapshotId}/export`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snapshot_${snapshotId.slice(0, 8)}.sql`;
        a.click();
        URL.revokeObjectURL(url);
        toast('SQL exported');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function deleteSnapshot(snapshotId) {
    if (!confirm('Delete this snapshot and its session data?')) return;
    try {
        await apiJson(`/snapshots/${snapshotId}`, { method: 'DELETE' });
        toast('Snapshot deleted');
        loadSnapshots();
    } catch (e) {
        toast(e.message, 'error');
    }
}
