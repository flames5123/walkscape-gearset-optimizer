/**
 * Info Modal Module (About + Help tabs)
 *
 * Combined modal with two tabs:
 * - About: version info, known issues, planned features, credits
 * - Help: getting started, key features, tips & tricks
 */

/**
 * Fetch and display version information
 */
async function loadVersionInfo() {
    const versionElement = document.getElementById('about-version-info');
    if (!versionElement) return;

    try {
        const response = await fetch('/api/version');
        const data = await response.json();

        if (data.last_updated) {
            versionElement.textContent = `Last updated: ${data.last_updated}`;
        } else if (data.commit_date) {
            versionElement.textContent = `Last updated: ${data.commit_date}`;
        } else {
            versionElement.textContent = `Version: ${data.version}`;
        }
    } catch (error) {
        console.error('Failed to load version info:', error);
        versionElement.textContent = 'Version info unavailable';
    }
}

/**
 * Switch the active tab inside the info modal
 * @param {string} tabName - 'about' or 'help'
 */
function switchInfoTab(tabName) {
    document.querySelectorAll('.info-tab-content').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('[data-info-tab]').forEach(btn => {
        btn.classList.remove('active');
    });

    const tabEl = document.getElementById(`info-tab-${tabName}`);
    if (tabEl) tabEl.style.display = '';

    const tabBtn = document.querySelector(`[data-info-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');
}

/**
 * Initialize the combined info modal (About + Help tabs)
 */
export function initInfoModal() {
    const infoBtn = document.getElementById('info-btn');
    const infoModal = document.getElementById('info-modal');
    const infoClose = document.getElementById('info-close');
    const infoOk = document.getElementById('info-ok');

    if (!infoBtn || !infoModal || !infoClose || !infoOk) {
        console.error('Info modal elements not found:', {
            infoBtn: !!infoBtn,
            infoModal: !!infoModal,
            infoClose: !!infoClose,
            infoOk: !!infoOk
        });
        return;
    }

    const openModal = (tab = 'about') => {
        infoModal.style.display = 'flex';
        switchInfoTab(tab);
        if (tab === 'about') loadVersionInfo();
        setTimeout(() => infoModal.classList.add('show'), 10);
    };

    const closeModal = () => {
        infoModal.classList.remove('show');
        setTimeout(() => { infoModal.style.display = 'none'; }, 200);
    };

    infoBtn.addEventListener('click', () => openModal('about'));
    infoClose.addEventListener('click', closeModal);
    infoOk.addEventListener('click', closeModal);

    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && infoModal.style.display === 'flex') closeModal();
    });

    // Tab switching
    infoModal.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-info-tab]');
        if (!btn) return;
        const tab = btn.dataset.infoTab;
        switchInfoTab(tab);
        if (tab === 'about') loadVersionInfo();
    });
}

/**
 * Show the info modal programmatically, optionally on a specific tab
 * @param {'about'|'help'} tab
 */
export function showInfoModal(tab = 'about') {
    const infoModal = document.getElementById('info-modal');
    if (!infoModal) return;
    infoModal.style.display = 'flex';
    switchInfoTab(tab);
    if (tab === 'about') loadVersionInfo();
    setTimeout(() => infoModal.classList.add('show'), 10);
}

// Legacy compat exports so any existing callers don't break
export function initAboutModal() { initInfoModal(); }
export function showHelpModal() { showInfoModal('help'); }
