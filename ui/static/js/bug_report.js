/**
 * Bug Report Module
 * 
 * Handles bug report submission with:
 * - Screenshot capture of all tabs
 * - Session state snapshot
 * - Browser and app version detection
 * - Debug log attachment when debug mode is active
 */

import { getDebugLog, isDebugEnabled } from './debug-console.js';

// We'll use html2canvas-pro from CDN (drop-in replacement for html2canvas)
const html2canvas = window.html2canvas;

const APP_VERSION = '1.0.0';

/**
 * Get browser information
 */
function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browserName = 'Unknown';
    let browserVersion = 'Unknown';

    // Detect browser
    if (ua.indexOf('Firefox') > -1) {
        browserName = 'Firefox';
        browserVersion = ua.match(/Firefox\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Chrome') > -1) {
        browserName = 'Chrome';
        browserVersion = ua.match(/Chrome\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Safari') > -1) {
        browserName = 'Safari';
        browserVersion = ua.match(/Version\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Edge') > -1) {
        browserName = 'Edge';
        browserVersion = ua.match(/Edge\/([0-9.]+)/)?.[1] || 'Unknown';
    }

    return {
        name: browserName,
        version: browserVersion,
        userAgent: ua,
        platform: navigator.platform,
        language: navigator.language,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        viewportSize: `${window.innerWidth}x${window.innerHeight}`
    };
}

/**
 * Capture screenshot of a specific element
 */
async function captureScreenshot(element) {
    const elementId = element.id || element.className || 'unknown';
    console.log(`[BugReport] captureScreenshot start: ${elementId}`);
    const startTime = performance.now();

    // Resolve CSS custom properties that html2canvas can't handle
    // by temporarily inlining computed sizes on gear slots
    const gearSlots = element.querySelectorAll('.gear-slot');
    const slotIcons = element.querySelectorAll('.gear-slot .slot-icon');
    const savedStyles = [];

    gearSlots.forEach(slot => {
        const computed = getComputedStyle(slot);
        savedStyles.push({ el: slot, width: slot.style.width, height: slot.style.height });
        slot.style.width = computed.width;
        slot.style.height = computed.height;
    });

    slotIcons.forEach(icon => {
        const computed = getComputedStyle(icon);
        savedStyles.push({ el: icon, width: icon.style.width, height: icon.style.height });
        icon.style.width = computed.width;
        icon.style.height = computed.height;
    });

    try {
        // Check if html2canvas is available
        if (!window.html2canvas) {
            console.error('[BugReport] html2canvas / html2canvas-pro not loaded');
            return null;
        }

        // Constrain capture to visible area — prevents capturing full scroll height
        // which produces absurdly tall images on mobile
        const rect = element.getBoundingClientRect();
        const captureHeight = Math.min(element.scrollHeight, rect.height || window.innerHeight);

        // Wrap html2canvas in a timeout — it can hang indefinitely on Safari
        const CAPTURE_TIMEOUT_MS = 5000;
        console.log(`[BugReport] calling html2canvas for ${elementId} (timeout: ${CAPTURE_TIMEOUT_MS}ms, h: ${Math.round(captureHeight)})`);
        const canvas = await Promise.race([
            window.html2canvas(element, {
                backgroundColor: '#1a1a1a',
                scale: window.devicePixelRatio || 2,
                logging: false,
                useCORS: true,
                allowTaint: true,
                height: captureHeight,
                windowHeight: captureHeight
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Screenshot capture timed out')), CAPTURE_TIMEOUT_MS)
            )
        ]);

        const elapsed = Math.round(performance.now() - startTime);
        console.log(`[BugReport] captureScreenshot success: ${elementId} (${elapsed}ms)`);
        return canvas.toDataURL('image/png');
    } catch (error) {
        const elapsed = Math.round(performance.now() - startTime);
        console.warn(`[BugReport] captureScreenshot failed: ${elementId} after ${elapsed}ms — ${error.message}`);
        return null;
    } finally {
        // Always restore original styles, even on timeout
        savedStyles.forEach(({ el, width, height }) => {
            el.style.width = width;
            el.style.height = height;
        });
    }
}

/**
 * Capture screenshots of all tabs/columns
 */
async function captureAllScreenshots() {
    const screenshots = {};
    const startTime = performance.now();
    console.log('[BugReport] captureAllScreenshots start');

    // Check if the crafting tree overlay is open
    const craftingTreeContainer = document.getElementById('crafting-tree-container');
    const isCraftingTreeOpen = craftingTreeContainer
        && craftingTreeContainer.style.display !== 'none'
        && !craftingTreeContainer.classList.contains('closing');

    // Check if the stats report page is open
    const statsReportPage = document.getElementById('stats-report-page');
    const isStatsReportOpen = statsReportPage
        && statsReportPage.style.display !== 'none'
        && !statsReportPage.classList.contains('closing');

    // Check if we're on the travel-config page
    const travelPage = document.getElementById('travel-config-page');
    const isOnTravelPage = travelPage && travelPage.style.display !== 'none';

    if (isCraftingTreeOpen) {
        console.log('[BugReport] crafting tree overlay open, capturing it');
        const screenshot = await captureScreenshot(craftingTreeContainer);
        if (screenshot) {
            screenshots['Crafting Tree'] = screenshot;
        }
    }

    if (isStatsReportOpen) {
        console.log('[BugReport] stats report page open, capturing it');
        const screenshot = await captureScreenshot(statsReportPage);
        if (screenshot) {
            screenshots['Stats Report'] = screenshot;
        }
    }

    if (isOnTravelPage) {
        console.log('[BugReport] on travel-config page, capturing single screenshot');
        // Capture the travel config page content
        const screenshot = await captureScreenshot(travelPage);
        if (screenshot) {
            screenshots['Travel Config'] = screenshot;
        }
    } else if (!isCraftingTreeOpen && !isStatsReportOpen) {
        // Capture the standard 3-column layout
        const columns = document.querySelectorAll('.column');
        console.log(`[BugReport] capturing ${columns.length} columns`);

        for (const column of columns) {
            const columnId = column.id;
            const columnName = column.querySelector('.column-header h2')?.textContent || columnId;

            // Make column visible temporarily if hidden (mobile)
            const wasHidden = !column.classList.contains('active-mobile-column');
            if (wasHidden) {
                column.classList.add('active-mobile-column');
                // Wait for render
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Capture screenshot
            const screenshot = await captureScreenshot(column);
            if (screenshot) {
                screenshots[columnName] = screenshot;
            } else {
                console.warn(`[BugReport] no screenshot returned for column: ${columnName}`);
            }

            // Restore visibility
            if (wasHidden) {
                column.classList.remove('active-mobile-column');
            }
        }
    }

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[BugReport] captureAllScreenshots done: ${Object.keys(screenshots).length} captured in ${elapsed}ms`);
    return screenshots;
}

/**
 * Show status message in bug report modal
 */
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('bug-report-status');
    statusEl.textContent = message;
    statusEl.className = `bug-report-status ${type}`;
    statusEl.style.display = 'block';
}

/**
 * Hide status message
 */
function hideStatus() {
    const statusEl = document.getElementById('bug-report-status');
    statusEl.style.display = 'none';
}

/**
 * Submit bug report
 */
async function submitBugReport(description, includeScreenshots = true) {
    const submitBtn = document.getElementById('bug-report-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    try {
        // Disable submit button
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnSpinner.style.display = 'inline';

        // Capture screenshots only if checkbox is checked
        let screenshots = {};
        if (includeScreenshots) {
            showStatus('Capturing screenshots...', 'info');
            console.log('[BugReport] starting screenshot capture (include=true)');
            try {
                // Total timeout for all screenshots — prevents infinite hang
                const ALL_SCREENSHOTS_TIMEOUT_MS = 10000;
                screenshots = await Promise.race([
                    captureAllScreenshots(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Screenshot capture timed out')), ALL_SCREENSHOTS_TIMEOUT_MS)
                    )
                ]);
                console.log('Screenshots captured:', Object.keys(screenshots).length);
            } catch (screenshotError) {
                console.warn('[BugReport] screenshot capture failed, submitting without:', screenshotError.message);
                screenshots = {};
            }
        } else {
            console.log('Screenshots skipped by user');
        }

        showStatus('Submitting report...', 'info');

        // Get browser info
        const browserInfo = getBrowserInfo();
        console.log('Browser info:', browserInfo);

        // Submit to API
        console.log('Submitting to /api/bug-reports...');

        // Build request body
        const requestBody = {
            description: description,
            app_version: APP_VERSION,
            browser_info: JSON.stringify(browserInfo),
            screenshots: screenshots
        };

        // Always include JS console log in bug reports
        const debugLog = getDebugLog();
        if (debugLog && debugLog.length > 0) {
            const formatted = debugLog.map(e =>
                `${e.timestamp} [${e.level.toUpperCase()}] ${e.message}`
            ).join('\n');
            requestBody.debug_log = formatted;
            console.log(`Including debug log (${debugLog.length} entries)`);
        }

        const response = await fetch('/api/bug-reports', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            let errorMessage = 'Failed to submit report';
            try {
                const error = JSON.parse(errorText);
                errorMessage = error.message || error.detail?.message || errorMessage;
            } catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log('Report submitted successfully:', result);

        showStatus('Report submitted successfully! Thank you.', 'success');

        // Close modal after 2 seconds
        setTimeout(() => {
            closeBugReportModal();
        }, 2000);

    } catch (error) {
        console.error('Bug report submission failed:', error);
        showStatus(`Failed to submit report: ${error.message}`, 'error');

        // Re-enable submit button
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
    }
}

/**
 * Check if push notifications are supported on this browser/context.
 */
function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
}

/**
 * Check if we're on iOS outside a PWA (push requires home-screen install).
 */
function isIosNonPwa() {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isPwa = window.navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
    return isIos && !isPwa;
}

/**
 * Check if the user has permanently dismissed the notifications prompt.
 * Reads from the state store (which is hydrated from the server's ui_config).
 */
function isNotifyDismissed() {
    try {
        if (window.store?.state?.ui?.bugReportNotifyDismissed) return true;
    } catch (_) { /* noop */ }
    // Fallback for before-session-load case
    return localStorage.getItem('bugReportNotifyDismissed') === '1';
}

/**
 * Persist dismissal both locally (instant) and to the server (per-session).
 */
function persistNotifyDismissed() {
    try {
        localStorage.setItem('bugReportNotifyDismissed', '1');
    } catch (_) { /* noop */ }
    if (window.store?.state?.ui) {
        window.store.state.ui.bugReportNotifyDismissed = true;
    }
    const uuid = window.store?.state?.session?.uuid;
    if (uuid && window.api?.updateConfig) {
        // Path prefix "ui." routes the value into ui_config on the backend.
        window.api.updateConfig(uuid, 'ui.bugReportNotifyDismissed', true);
    }
}

/**
 * Show or hide the "Enable Notifications" block based on current permission state.
 * Only shown when push is supported and the user hasn't made a decision yet.
 */
function updateNotifyBlockVisibility() {
    const block = document.getElementById('bug-report-notify');
    if (!block) return;

    if (!pushSupported() || isIosNonPwa() || isNotifyDismissed()) {
        block.style.display = 'none';
        return;
    }

    const permission = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
    if (permission === 'default') {
        block.style.display = '';
        const btn = document.getElementById('bug-report-enable-notifications');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔔 Enable Notifications';
        }
    } else {
        block.style.display = 'none';
    }
}

/**
 * Handle click on the "Enable Notifications" button inside the bug report modal.
 * Reuses the settings modal's push initialization flow.
 */
async function handleEnableNotificationsClick() {
    const btn = document.getElementById('bug-report-enable-notifications');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = 'Setting up notifications…';

    try {
        // Prefer the existing settings-modal init path so prefs/subscription
        // flow stays consistent with the Personalization tab.
        if (window.settingsModal && typeof window.settingsModal._initPushNotifications === 'function') {
            window.settingsModal._pushPermission = 'granted';
            await window.settingsModal._initPushNotifications();
        } else {
            // Fallback: request permission directly, then subscribe.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                updateNotifyBlockVisibility();
                return;
            }
        }
    } catch (err) {
        console.error('[BugReport] Failed to enable notifications:', err);
    }

    updateNotifyBlockVisibility();
}

/**
 * Open bug report modal
 */
export function openBugReportModal() {
    const modal = document.getElementById('bug-report-modal');
    const descriptionEl = document.getElementById('bug-description');

    // Reset form
    descriptionEl.value = '';
    document.getElementById('bug-description-count').textContent = '0';
    hideStatus();

    // Refresh the "Enable Notifications" block based on current permission state
    updateNotifyBlockVisibility();

    // Use CSS class for animation (consistent with other modals)
    modal.style.display = 'flex';
    // Small delay to ensure display change is processed
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);

    descriptionEl.focus();
}

/**
 * Close bug report modal
 */
export function closeBugReportModal() {
    const modal = document.getElementById('bug-report-modal');

    // Use CSS class for animation (consistent with other modals)
    modal.classList.remove('show');

    // Wait for animation to complete, then hide
    setTimeout(() => {
        modal.style.display = 'none';

        // Reset submit button
        const submitBtn = document.getElementById('bug-report-submit');
        const btnText = submitBtn.querySelector('.btn-text');
        const btnSpinner = submitBtn.querySelector('.btn-spinner');
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
    }, 200);
}

/**
 * Initialize bug report module
 */
export function initBugReport() {
    // Report button
    const reportBtn = document.getElementById('report-btn');
    reportBtn.addEventListener('click', openBugReportModal);

    // Close button
    const closeBtn = document.getElementById('bug-report-close');
    closeBtn.addEventListener('click', closeBugReportModal);

    // Cancel button
    const cancelBtn = document.getElementById('bug-report-cancel');
    cancelBtn.addEventListener('click', closeBugReportModal);

    // Submit button
    const submitBtn = document.getElementById('bug-report-submit');
    submitBtn.addEventListener('click', async () => {
        const description = document.getElementById('bug-description').value.trim();

        if (!description) {
            showStatus('Please describe the issue', 'error');
            return;
        }

        const includeScreenshots = document.getElementById('bug-include-screenshots').checked;
        await submitBugReport(description, includeScreenshots);
    });

    // Character counter
    const descriptionEl = document.getElementById('bug-description');
    const countEl = document.getElementById('bug-description-count');
    descriptionEl.addEventListener('input', () => {
        countEl.textContent = descriptionEl.value.length;
    });

    // Enable Notifications button (shown when permission is 'default')
    const enableNotifBtn = document.getElementById('bug-report-enable-notifications');
    if (enableNotifBtn) {
        enableNotifBtn.addEventListener('click', handleEnableNotificationsClick);
    }

    // Dismiss "x" on the notifications prompt — permanent, saved to session
    const dismissNotifBtn = document.getElementById('bug-report-notify-dismiss');
    if (dismissNotifBtn) {
        dismissNotifBtn.addEventListener('click', () => {
            persistNotifyDismissed();
            updateNotifyBlockVisibility();
        });
    }

    // Close on outside click
    const modal = document.getElementById('bug-report-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeBugReportModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $(modal).is(':visible')) {
            closeBugReportModal();
        }
    });
}
