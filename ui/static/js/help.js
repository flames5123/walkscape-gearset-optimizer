/**
 * Help/Tutorial Modal Module
 * 
 * Handles the help modal display with:
 * - Getting started guide
 * - Key features overview
 * - Stats explanations
 * - Tips and tricks
 */

/**
 * Initialize help modal
 */
export function initHelpModal() {
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const helpClose = document.getElementById('help-close');
    const helpOk = document.getElementById('help-ok');

    // Safety check - if elements don't exist, log error and return
    if (!helpBtn || !helpModal || !helpClose || !helpOk) {
        console.error('Help modal elements not found:', {
            helpBtn: !!helpBtn,
            helpModal: !!helpModal,
            helpClose: !!helpClose,
            helpOk: !!helpOk
        });
        return;
    }

    // Open modal
    helpBtn.addEventListener('click', () => {
        console.log('Help button clicked');
        helpModal.style.display = 'flex';
        console.log('Modal display set to flex');
        // Small delay to ensure display change is processed before adding show class
        setTimeout(() => {
            helpModal.classList.add('show');
            console.log('Added show class');
        }, 10);
    });

    // Close modal handlers
    const closeModal = () => {
        helpModal.classList.remove('show');
        setTimeout(() => {
            helpModal.style.display = 'none';
        }, 200);
    };

    helpClose.addEventListener('click', closeModal);
    helpOk.addEventListener('click', closeModal);

    // Close on overlay click
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            closeModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpModal.style.display === 'flex') {
            closeModal();
        }
    });
}

/**
 * Show help modal programmatically
 */
export function showHelpModal() {
    const helpModal = document.getElementById('help-modal');
    if (helpModal) {
        helpModal.style.display = 'flex';
        setTimeout(() => {
            helpModal.classList.add('show');
        }, 10);
    }
}
