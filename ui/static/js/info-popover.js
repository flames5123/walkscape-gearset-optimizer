/**
 * Info Popover — shows a small tooltip popover next to an (i) icon.
 *
 * Desktop: hover shows it, mouseout hides it. Click pins it (stays open).
 * Mobile: tap shows it, tap anywhere dismisses.
 * Clicking the popover itself always dismisses it.
 */

let activePopover = null;
let dismissTimer = null;
let popoverId = 0;
let anchorObserver = null;
let globalDismissHandler = null;
let stalePopoverCheckInterval = null;

/**
 * Show an info popover next to the given element.
 * @param {HTMLElement} anchor - The (i) icon element
 * @param {string} text - The info text to display
 * @param {boolean} pinned - If true, popover stays until explicitly dismissed
 * @param {string} [title] - Optional bold title shown at the top of the popover
 * @param {string} [htmlContent] - Optional raw HTML content (bypasses text escaping)
 */
export function showInfoPopover(anchor, text, pinned = false, title = null, htmlContent = null) {
    // Pin Item support: if the caller is passing a source element and we
    // have a "mirror override" set by the pinned controller, anchor at the
    // mirror instead so the popover renders next to the user's cursor
    // (in the pinned container) rather than at the off-screen source.
    if (typeof window !== 'undefined' && window.__pinMirrorAnchorOverride) {
        anchor = window.__pinMirrorAnchorOverride;
    }

    // Cancel any pending dismiss
    clearTimeout(dismissTimer);
    dismissTimer = null;

    // If same anchor is already showing and pinned, toggle off
    if (activePopover && activePopover.anchor === anchor && activePopover.pinned) {
        dismissPopover();
        return;
    }

    // Remove existing popover
    if (activePopover) {
        activePopover.el.remove();
        activePopover = null;
    }

    const id = ++popoverId;
    const popover = document.createElement('div');
    popover.className = 'info-popover';

    if (htmlContent) {
        // Raw HTML mode — caller is responsible for escaping
        popover.innerHTML = htmlContent;
    } else {
        // Build HTML: optional bold title + body lines
        let html = '';
        if (title) {
            const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += `<div class="info-popover-title">${escapedTitle}</div>`;
        }
        // Render \n as <br> for multi-line content
        html += text
            .split('\n')
            .map(line => `<span>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`)
            .join('<br>');
        popover.innerHTML = html;
    }
    document.body.appendChild(popover);

    // Position relative to anchor — try: right, below, left, above
    const rect = anchor.getBoundingClientRect();
    const popW = Math.min(280, window.innerWidth - 24);
    popover.style.maxWidth = popW + 'px';

    const popRect = popover.getBoundingClientRect();
    const margin = 8;
    const edgePad = 12;

    let left, top;
    let placed = false;

    // 1. Try RIGHT of anchor (vertical will be clamped later)
    left = rect.right + margin;
    top = rect.top + (rect.height / 2) - (popRect.height / 2);
    if (left + popRect.width <= window.innerWidth - edgePad) {
        placed = true;
    }

    // 2. Try BELOW anchor
    if (!placed) {
        left = rect.left;
        top = rect.bottom + margin;
        if (top + popRect.height <= window.innerHeight - edgePad) {
            placed = true;
        }
    }

    // 3. Try LEFT of anchor (vertical will be clamped later)
    if (!placed) {
        left = rect.left - popRect.width - margin;
        top = rect.top + (rect.height / 2) - (popRect.height / 2);
        if (left >= edgePad) {
            placed = true;
        }
    }

    // 4. Try ABOVE anchor
    if (!placed) {
        left = rect.left;
        top = rect.top - popRect.height - margin;
        if (top >= edgePad) {
            placed = true;
        }
    }

    // 5. Fallback — clamp to viewport (may overlap anchor)
    if (!placed) {
        left = rect.left;
        top = rect.bottom + margin;
    }

    // Final clamp to viewport edges
    top = Math.max(edgePad, Math.min(top, window.innerHeight - popRect.height - edgePad));
    left = Math.max(edgePad, Math.min(left, window.innerWidth - popRect.width - edgePad));

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    activePopover = { el: popover, anchor, pinned, id };

    // Click on popover dismisses it
    popover.addEventListener('click', () => dismissPopover());

    // Hover popovers: dismiss when the cursor leaves the popover itself.
    // (Anchor's mouseleave handles the case where cursor never enters the popover.)
    if (!pinned && !isTouchDevice()) {
        popover.addEventListener('mouseenter', () => {
            // Cancel pending dismiss if cursor moves onto the popover
            clearTimeout(dismissTimer);
            dismissTimer = null;
        });
        popover.addEventListener('mouseleave', () => {
            scheduleDismiss(id);
        });
    }

    // Start watching for anchor removal (covers re-renders that orphan the anchor)
    startAnchorWatch();

    // Always install a global dismiss handler as a safety net.
    // For pinned/touch popovers we react on click/tap outside; for hover popovers,
    // any scroll or click elsewhere kills the popover so it never gets stuck.
    installGlobalDismissHandler();

    // On mobile or pinned, dismiss on outside click
    // Use longer delay on touch to avoid the current tap triggering immediate dismiss
    if (pinned || isTouchDevice()) {
        const delay = isTouchDevice() ? 500 : 0;
        setTimeout(() => {
            // Use touchend on mobile (more reliable than pointerdown for outside-tap detection)
            const eventType = isTouchDevice() ? 'touchend' : 'pointerdown';
            document.addEventListener(eventType, onOutsideClick, { once: true, capture: true });
        }, delay);
    }
}

/**
 * Schedule a dismiss for a specific popover ID (used by mouseleave).
 * If a new popover was shown before the timer fires, the dismiss is skipped.
 */
function scheduleDismiss(forId) {
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
        if (activePopover && activePopover.id === forId && !activePopover.pinned) {
            dismissPopover();
        }
        dismissTimer = null;
    }, 200);
}

function onOutsideClick(e) {
    if (activePopover && !activePopover.el.contains(e.target) && e.target !== activePopover.anchor) {
        dismissPopover();
    } else if (activePopover) {
        const eventType = isTouchDevice() ? 'touchend' : 'pointerdown';
        document.addEventListener(eventType, onOutsideClick, { once: true, capture: true });
    }
}

export function dismissPopover() {
    clearTimeout(dismissTimer);
    dismissTimer = null;
    stopAnchorWatch();
    removeGlobalDismissHandler();
    if (activePopover) {
        const el = activePopover.el;
        activePopover = null;
        // Animate out (reverse of in)
        el.style.animation = 'info-popover-out 0.12s ease-in forwards';
        setTimeout(() => el.remove(), 120);
    }
}

function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Watch for anchor removal from the DOM. When components re-render, the (i) icon
 * element is destroyed but the popover stays in document.body — this orphans it.
 * Use a MutationObserver plus a periodic isConnected check as a backstop.
 */
function startAnchorWatch() {
    stopAnchorWatch();

    // MutationObserver catches most cases where the anchor's subtree is replaced.
    if (typeof MutationObserver !== 'undefined') {
        anchorObserver = new MutationObserver(() => {
            if (activePopover && activePopover.anchor && !activePopover.anchor.isConnected) {
                dismissPopover();
            }
        });
        anchorObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Backstop: in case a mutation is missed (e.g., direct innerHTML on document.body
    // subtree happens before the observer fires), check every 300ms.
    stalePopoverCheckInterval = setInterval(() => {
        if (activePopover && activePopover.anchor && !activePopover.anchor.isConnected) {
            dismissPopover();
        }
    }, 300);
}

function stopAnchorWatch() {
    if (anchorObserver) {
        anchorObserver.disconnect();
        anchorObserver = null;
    }
    if (stalePopoverCheckInterval) {
        clearInterval(stalePopoverCheckInterval);
        stalePopoverCheckInterval = null;
    }
}

/**
 * Install a single document-level listener that dismisses any popover on scroll
 * or on a click that lands outside the popover and anchor. This is a safety net
 * so popovers can never get stuck if the anchor is detached or events are missed.
 */
function installGlobalDismissHandler() {
    removeGlobalDismissHandler();
    globalDismissHandler = (e) => {
        if (!activePopover) {
            removeGlobalDismissHandler();
            return;
        }
        // Scroll events always dismiss — the popover's absolute position goes stale
        if (e.type === 'scroll') {
            dismissPopover();
            return;
        }
        // For pointer events, dismiss if click is outside both the popover and anchor
        const target = e.target;
        const inPopover = activePopover.el.contains(target);
        const inAnchor = activePopover.anchor && activePopover.anchor.contains
            && activePopover.anchor.contains(target);
        if (!inPopover && !inAnchor) {
            dismissPopover();
        }
    };
    document.addEventListener('pointerdown', globalDismissHandler, { capture: true });
    // Use capture + passive for scroll so we catch it even on nested scroll containers.
    window.addEventListener('scroll', globalDismissHandler, { capture: true, passive: true });
}

function removeGlobalDismissHandler() {
    if (globalDismissHandler) {
        document.removeEventListener('pointerdown', globalDismissHandler, { capture: true });
        window.removeEventListener('scroll', globalDismissHandler, { capture: true });
        globalDismissHandler = null;
    }
}

/**
 * Attach hover + click behavior to all .travel-info-icon elements within a container.
 * @param {HTMLElement} container
 */
export function wireInfoIcons(container) {
    const icons = container.querySelectorAll('.travel-info-icon');
    for (const icon of icons) {
        const text = icon.dataset.info || '';
        const htmlContent = icon.dataset.infoHtml || null;
        if (!text && !htmlContent) continue;
        // Skip if already wired (prevents duplicate handlers on re-render)
        if (icon.dataset.infoWired) continue;
        icon.dataset.infoWired = '1';

        const title = icon.dataset.infoTitle || null;

        icon.removeAttribute('title');

        icon.addEventListener('mouseenter', () => {
            if (isTouchDevice()) return;  // Touch devices use click only
            if (activePopover && activePopover.pinned) return;
            // Cancel any pending dismiss from a previous icon's mouseleave
            clearTimeout(dismissTimer);
            dismissTimer = null;
            showInfoPopover(icon, text, false, title, htmlContent);
        });

        icon.addEventListener('mouseleave', () => {
            if (isTouchDevice()) return;  // Touch devices use click only
            if (activePopover && activePopover.pinned) return;
            if (activePopover && activePopover.anchor === icon) {
                scheduleDismiss(activePopover.id);
            }
        });

        icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (activePopover && activePopover.anchor === icon && activePopover.pinned) {
                dismissPopover();
            } else {
                showInfoPopover(icon, text, true, title, htmlContent);
            }
        });
    }
}
