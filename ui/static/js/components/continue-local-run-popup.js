/*
 * Continue-local-run popup (FAC: local_optimization).
 *
 * On page load, if an interrupted LOCAL goals-report run is resumable AND the
 * "Finish on server if I leave the page" setting is OFF, local-compute.js
 * dispatches `goalsReportResumePrompt` instead of silently auto-resuming. This
 * component shows a small prompt letting the user choose what to do:
 *   • Continue in browser  -> resume the local run (resumeLocalGoalsReportNow)
 *   • Finish on server      -> POST /api/stats-report/finish-on-server (the same
 *                              endpoint the leave-handoff beacon uses)
 *   • Dismiss               -> leave it paused (orphan-resume reconciles later)
 *
 * Self-contained inline styles (uses the app's CSS variables) so it needs no
 * stylesheet changes. Modeled on the PinFeatureIntroPopup body-append pattern.
 */

import { resumeLocalGoalsReportNow } from '../local-compute.js';

let _shown = false;

function _show(info) {
  if (_shown) return;
  _shown = true;

  const runId = (info.run_params && info.run_params.run_id) || info.run_id || null;
  const sessionUuid = (info.run_params && info.run_params.session_uuid) || null;
  const doneCount = (info.completed || []).length;

  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Continue goals report');
  card.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
    'z-index:10000', 'max-width:420px', 'width:calc(100% - 32px)',
    'background:var(--bg-secondary,#1e1e24)', 'color:var(--text-primary,#eee)',
    'border:1px solid var(--border-color,#3a3a44)', 'border-radius:10px',
    'box-shadow:0 6px 24px rgba(0,0,0,0.45)', 'padding:16px 18px',
    'font-size:0.92em', 'line-height:1.4',
  ].join(';');

  const btnBase = 'border:none;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:0.9em;font-weight:600;';
  card.innerHTML = `
    <div style="font-weight:700;font-size:1.02em;margin-bottom:6px;">Continue your goals report?</div>
    <div style="color:var(--text-muted,#aaa);margin-bottom:14px;">
      A local goals report didn't finish before you left${doneCount ? ` (${doneCount} already done)` : ''}.
      Continue running it in your browser, or let the server finish it?
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
      <button class="clr-dismiss" style="${btnBase}background:var(--bg-tertiary,#2a2a32);color:var(--text-primary,#eee);">Dismiss</button>
      <button class="clr-server" style="${btnBase}background:var(--bg-tertiary,#2a2a32);color:var(--text-primary,#eee);">Finish on server</button>
      <button class="clr-continue" style="${btnBase}background:var(--accent-primary,var(--accent-color,#4a9eff));color:#fff;">Continue in browser</button>
    </div>
  `;
  document.body.appendChild(card);

  const close = () => { if (card.parentNode) card.parentNode.removeChild(card); };

  card.querySelector('.clr-continue').addEventListener('click', () => {
    close();
    // Tell the goals-report page to show the running UI (progress bar +
    // spinner + polling) — same state Optimize All produces — so the resume
    // visibly continues instead of looking like nothing happened.
    try {
      window.dispatchEvent(new CustomEvent('goalsReportResumeStarted',
        { detail: { run_id: runId, completed: doneCount, mode: 'browser' } }));
    } catch (_) { /* ignore */ }
    try { resumeLocalGoalsReportNow(info); }
    catch (e) { console.error('[local-goals] continue failed:', e); }
  });

  card.querySelector('.clr-server').addEventListener('click', () => {
    close();
    if (!runId || !sessionUuid) return;
    // Same running-UI handoff as the browser path; the server's --resume
    // worker drives progress, which the page's /status poll will track.
    try {
      window.dispatchEvent(new CustomEvent('goalsReportResumeStarted',
        { detail: { run_id: runId, completed: doneCount, mode: 'server' } }));
    } catch (_) { /* ignore */ }
    try {
      fetch('/api/stats-report/finish-on-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, session_uuid: sessionUuid }),
      }).then(() => {
        // Nudge the goals-report page to poll /status for the server's progress.
        try { window.dispatchEvent(new CustomEvent('statsReportLocalRunFinished')); } catch (_) { /* ignore */ }
      }).catch(() => { /* best-effort */ });
      console.log('[local-goals] handing interrupted run off to the server to finish');
    } catch (e) { console.error('[local-goals] finish-on-server failed:', e); }
  });

  card.querySelector('.clr-dismiss').addEventListener('click', close);
}

if (typeof window !== 'undefined') {
  window.addEventListener('goalsReportResumePrompt', (e) => {
    const info = e && e.detail && e.detail.info;
    if (info) _show(info);
  });
}
