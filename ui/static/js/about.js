/**
 * About Modal Module
 * 
 * Handles the about modal display with:
 * - Version and last update info
 * - Known issues list
 * - Planned/TODO features
 * - Credits and acknowledgments
 */

/**
 * Fetch and display version information
 */
async function loadVersionInfo() {
    const versionElement = document.getElementById('about-version-info');

    if (!versionElement) {
        console.error('Version info element not found');
        return;
    }

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
 * Initialize about modal
 */
export function initAboutModal() {
    const aboutBtn = document.getElementById('about-btn');
    const aboutModal = document.getElementById('about-modal');
    const aboutClose = document.getElementById('about-close');
    const aboutOk = document.getElementById('about-ok');

    // Safety check - if elements don't exist, log error and return
    if (!aboutBtn || !aboutModal || !aboutClose || !aboutOk) {
        console.error('About modal elements not found:', {
            aboutBtn: !!aboutBtn,
            aboutModal: !!aboutModal,
            aboutClose: !!aboutClose,
            aboutOk: !!aboutOk
        });
        return;
    }

    // Open modal
    aboutBtn.addEventListener('click', () => {
        console.log('About button clicked');
        aboutModal.style.display = 'flex';
        console.log('Modal display set to flex');

        // Load version info when modal opens
        loadVersionInfo();

        // Small delay to ensure display change is processed before adding show class
        setTimeout(() => {
            aboutModal.classList.add('show');
            console.log('Added show class');
        }, 10);
    });

    // Close modal handlers
    const closeModal = () => {
        aboutModal.classList.remove('show');
        setTimeout(() => {
            aboutModal.style.display = 'none';
        }, 200);
    };

    aboutClose.addEventListener('click', closeModal);
    aboutOk.addEventListener('click', closeModal);

    // Close on overlay click
    aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) {
            closeModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && aboutModal.style.display === 'flex') {
            closeModal();
        }
    });
}
