/**
 * Announcements Modal Module
 *
 * Fetches all broadcasts from the API and displays them
 * in a modal with message text and creation date.
 */

/**
 * Format a timestamp string into a readable date
 * @param {string} timestamp - ISO or SQLite timestamp string
 * @returns {string} Formatted date string
 */
function formatDate(timestamp) {
    if (!timestamp) return 'Unknown date';
    try {
        // Append 'Z' if no timezone info so JS treats it as UTC
        let ts = timestamp;
        if (!ts.endsWith('Z') && !ts.includes('+') && !ts.includes('T')) {
            ts = ts.replace(' ', 'T') + 'Z';
        } else if (!ts.endsWith('Z') && !ts.includes('+')) {
            ts = ts + 'Z';
        }
        const date = new Date(ts);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return timestamp;
    }
}

/**
 * Load and render announcements into the modal
 */
async function loadAnnouncements() {
    const listEl = document.getElementById('announcements-list');
    if (!listEl) return;

    listEl.innerHTML = '<p class="announcements-loading">Loading announcements...</p>';

    try {
        // Fetch both global and targeted broadcasts in parallel
        const [globalResp, targetedResp] = await Promise.all([
            fetch('/api/broadcasts'),
            fetch('/api/targeted-broadcasts').catch(() => ({ json: () => ({ broadcasts: [] }) })),
        ]);
        const globalData = await globalResp.json();
        const targetedData = await targetedResp.json();

        const globalBroadcasts = globalData.broadcasts || [];
        const targetedBroadcasts = targetedData.broadcasts || [];

        if (globalBroadcasts.length === 0 && targetedBroadcasts.length === 0) {
            listEl.innerHTML = '<p class="announcements-empty">No announcements yet.</p>';
            return;
        }

        listEl.innerHTML = '';

        // Merge all broadcasts and sort by date descending
        const allBroadcasts = [
            ...targetedBroadcasts.map(b => ({ ...b, isTargeted: true })),
            ...globalBroadcasts.map(b => ({ ...b, isTargeted: false })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        for (const b of allBroadcasts) {
            const item = document.createElement('div');
            if (b.isTargeted) {
                item.className = 'announcement-item active targeted';
                item.innerHTML =
                    `<div class="announcement-badge">🔒 For You</div>` +
                    `<div class="announcement-message">${renderMessage(b.message)}</div>` +
                    `<div class="announcement-meta">${formatDate(b.created_at)}</div>`;
            } else {
                item.className = 'announcement-item' + (b.active ? ' active' : '');
                item.innerHTML =
                    `<div class="announcement-message">${renderMessage(b.message)}</div>` +
                    `<div class="announcement-meta">${formatDate(b.created_at)}</div>`;
            }
            listEl.appendChild(item);
        }
    } catch (error) {
        console.error('Failed to load announcements:', error);
        listEl.innerHTML = '<p class="announcements-empty">Failed to load announcements.</p>';
    }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Render announcement message text with basic markdown support.
 * Supports:
 *   - [text](url) link syntax (relative paths and https:// only)
 *   - **bold** text
 *   - _italic_ text (underscores must be at word boundaries)
 *   - * bullet lists (lines starting with "* ")
 *   - Newlines converted to <br>
 * @param {string} text
 * @returns {string} HTML string safe to set as innerHTML
 */
function renderMessage(text) {
    const escaped = escapeHtml(text);

    // Replace [text](url) with <a> tags — only allow safe URLs
    let html = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
        const safe = url.startsWith('/') || url.startsWith('https://');
        if (!safe) return escapeHtml(`[${linkText}](${url})`);
        return `<a href="${escapeHtml(url)}" class="announcement-link" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });

    // Bold: **text** -> <strong>text</strong>
    // (must run before italic so ** isn't consumed by * matching)
    html = html.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');

    // Italic: _text_ -> <em>text</em>
    // Only match when underscores are at word boundaries so variable_names don't italicize.
    html = html.replace(/(^|[\s(>])_([^_\n]+?)_(?=[\s)<.,!?;:]|$)/g, '$1<em>$2</em>');

    // Line-oriented block handling:
    //   - ATX headings: "# ".."###### " -> <h1>..<h6> (inline styles so no CSS
    //     changes are needed; sizes tuned to fit the announcements modal).
    //   - Bullet lists: lines starting with "* " grouped into <ul>/<li>.
    // Split on newlines and walk line by line.
    const HEADING_STYLES = {
        1: 'font-size: max(var(--min-text, 5px), calc(1.4rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
        2: 'font-size: max(var(--min-text, 5px), calc(1.2rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
        3: 'font-size: max(var(--min-text, 5px), calc(1.05rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
        4: 'font-size: max(var(--min-text, 5px), calc(0.95rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
        5: 'font-size: max(var(--min-text, 5px), calc(0.88rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
        6: 'font-size: max(var(--min-text, 5px), calc(0.82rem * var(--text-scale, 1)));font-weight:600;margin:0.5em 0 0.3em;line-height:1.25',
    };
    const lines = html.split('\n');
    const result = [];
    // Nested bullet lists: the leading spaces before "* " set the nesting depth
    // (4 spaces per level). Track the number of open <ul>s and whether an <li>
    // is still open, so a deeper bullet nests INSIDE its parent <li>.
    let openUls = 0;
    let liOpen = false;
    const closeLists = () => {
        if (liOpen) { result.push('</li>'); liOpen = false; }
        while (openUls > 0) {
            result.push('</ul>');
            openUls--;
            if (openUls > 0) result.push('</li>');  // close the enclosing parent <li>
        }
    };

    for (const line of lines) {
        const leading = line.length - line.trimStart().length;
        const trimmed = line.trimStart();
        // ATX heading: 1-6 leading '#' then a space then content. Trailing
        // '#' (closing sequence) is stripped. '#' is not HTML-escaped, so the
        // marker survives the earlier escape/bold/italic passes intact.
        const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
            closeLists();
            const level = heading[1].length;
            result.push(`<h${level} class="announcement-heading" style="${HEADING_STYLES[level]}">${heading[2]}</h${level}>`);
        } else if (trimmed.startsWith('* ')) {
            const want = Math.floor(leading / 4) + 1;  // number of <ul>s this item sits under
            if (want > openUls) {
                // Deeper: nest new <ul>(s) inside the currently-open <li>.
                while (openUls < want) { result.push('<ul class="announcement-list">'); openUls++; }
            } else {
                // Same level or shallower: close the current <li>, then unwind to
                // the target depth (closing each closed ul's parent <li> too).
                if (liOpen) { result.push('</li>'); liOpen = false; }
                while (openUls > want) {
                    result.push('</ul>');
                    openUls--;
                    if (openUls > 0) result.push('</li>');
                }
            }
            result.push(`<li>${trimmed.slice(2)}`);  // opened here, closed lazily
            liOpen = true;
        } else {
            closeLists();
            result.push(line);
        }
    }
    closeLists();

    // Join and convert remaining newlines to <br>
    html = result.join('\n').replace(/\n/g, '<br>');

    // Collapse 3+ consecutive <br> into 2 (preserve intentional paragraph breaks)
    html = html.replace(/(<br>){3,}/gi, '<br><br>');

    // Remove <br> immediately before/after <ul>/<li> tags (list already has spacing)
    html = html.replace(/<br>(\s*<ul)/gi, '$1');
    html = html.replace(/<\/ul>\s*<br>/gi, '</ul>');
    html = html.replace(/<br>(\s*<li)/gi, '$1');
    html = html.replace(/<\/li>\s*<br>/gi, '</li>');
    // Nested lists close <li>/<ul> on their own result lines, which inserts a
    // stray <br> just before the closing tag — strip those too.
    html = html.replace(/<br>(\s*<\/li>)/gi, '$1');
    html = html.replace(/<br>(\s*<\/ul>)/gi, '$1');

    // Headings are block-level with their own margins — drop adjacent <br>.
    html = html.replace(/<br>(\s*<h[1-6])/gi, '$1');
    html = html.replace(/(<\/h[1-6]>)\s*<br>/gi, '$1');

    return html;
}

/**
 * Initialize announcements modal
 */
export function initAnnouncementsModal() {
    const btn = document.getElementById('announcements-btn');
    const modal = document.getElementById('announcements-modal');
    const closeBtn = document.getElementById('announcements-close');
    const okBtn = document.getElementById('announcements-ok');

    if (!btn || !modal || !closeBtn || !okBtn) {
        console.error('Announcements modal elements not found');
        return;
    }

    const openModal = () => {
        modal.style.display = 'flex';
        loadAnnouncements();
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    };

    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    };

    btn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    okBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    // Auto-popup: check for active broadcast the user hasn't seen
    checkAndAutoPopup(openModal);
}

/**
 * Check for an active broadcast and auto-open the modal if the user
 * hasn't dismissed it yet (tracked via localStorage).
 */
async function checkAndAutoPopup(openModal) {
    try {
        // Check both global and targeted broadcasts
        const [globalResp, targetedResp] = await Promise.all([
            fetch('/api/broadcast'),
            fetch('/api/targeted-broadcasts').catch(() => ({ json: () => ({ broadcasts: [] }) })),
        ]);
        const globalData = await globalResp.json();
        const targetedData = await targetedResp.json();

        const targetedBroadcasts = targetedData.broadcasts || [];
        const hasUnseen = targetedBroadcasts.some(b => {
            return localStorage.getItem(`dismissed_targeted_${b.id}`) !== 'true';
        });

        // Auto-popup for global broadcast
        let shouldPopup = false;
        let globalId = null;
        if (globalData.active) {
            globalId = globalData.id;
            const dismissedId = localStorage.getItem('dismissed_broadcast_id');
            if (dismissedId !== globalId) shouldPopup = true;
        }

        // Auto-popup for unseen targeted broadcasts
        if (hasUnseen) shouldPopup = true;

        if (!shouldPopup) return;

        openModal();

        // Mark as seen after they close it
        const modal = document.getElementById('announcements-modal');
        const observer = new MutationObserver(() => {
            if (modal.style.display === 'none' || !modal.classList.contains('show')) {
                if (globalId) localStorage.setItem('dismissed_broadcast_id', globalId);
                for (const b of targetedBroadcasts) {
                    localStorage.setItem(`dismissed_targeted_${b.id}`, 'true');
                }
                observer.disconnect();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    } catch {
        // Fail silently
    }
}
