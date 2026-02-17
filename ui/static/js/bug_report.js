/**
 * Bug Report Module
 * 
 * Handles bug report submission with:
 * - Screenshot capture of all tabs
 * - Session state snapshot
 * - Browser and app version detection
 */

// We'll use html2canvas from CDN
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
    try {
        // Check if html2canvas is available
        if (!window.html2canvas) {
            console.error('html2canvas not loaded');
            return null;
        }

        const canvas = await window.html2canvas(element, {
            backgroundColor: '#1a1a1a',
            scale: 1,
            logging: false,
            useCORS: true,
            allowTaint: true
        });

        return canvas.toDataURL('image/png');
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        return null;
    }
}

/**
 * Capture screenshots of all tabs/columns
 */
async function captureAllScreenshots() {
    const screenshots = {};

    // Get all columns
    const columns = document.querySelectorAll('.column');

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
        }

        // Restore visibility
        if (wasHidden) {
            column.classList.remove('active-mobile-column');
        }
    }

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
            try {
                screenshots = await captureAllScreenshots();
                console.log('Screenshots captured:', Object.keys(screenshots).length);
            } catch (screenshotError) {
                console.warn('Screenshot capture failed, continuing without screenshots:', screenshotError);
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
        const response = await fetch('/api/bug-reports', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: description,
                app_version: APP_VERSION,
                browser_info: JSON.stringify(browserInfo),
                screenshots: screenshots
            })
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
 * Open bug report modal
 */
export function openBugReportModal() {
    const modal = document.getElementById('bug-report-modal');
    const descriptionEl = document.getElementById('bug-description');

    // Reset form
    descriptionEl.value = '';
    document.getElementById('bug-description-count').textContent = '0';
    hideStatus();

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
