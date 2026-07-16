/**
 * PinFeatureIntroPopup — dismissable first-click intro.
 *
 * Uses the same dismissible-tip pattern as SettingsModal intro tips. Shown
 * once per session the first time the user clicks the Pin Icon; after either
 * button is clicked, the popup removes itself and fires onDismiss().
 */

export default class PinFeatureIntroPopup {
    /**
     * @param {Object} opts
     * @param {Function} opts.onDismiss  Called after the popup closes.
     */
    constructor({ onDismiss } = {}) {
        this.onDismiss = typeof onDismiss === 'function' ? onDismiss : () => { };
        this.$el = null;
    }

    show() {
        if (this.$el) return;
        const $el = $(`
            <div class="pin-feature-intro-popup" role="dialog" aria-labelledby="pin-intro-title">
                <div class="pin-feature-intro-popup-inner">
                    <h3 id="pin-intro-title">📌 Pin anything to the top</h3>
                    <p>Click the pin icon, hover (or tap on mobile) over an element in the Combined Stats row or anywhere in Column 3, then press <strong>Confirm</strong> (✓) to pin it.</p>
                    <p>Pinned items stay live — they update with your gear and trigger the same click / checkbox / typing behavior as the original.</p>
                    <p class="pin-intro-hint">Use <strong>▲ / ▼</strong> to pick a coarser or finer target before confirming.</p>
                    <button class="pin-intro-dismiss-btn" type="button">Got it</button>
                    <button class="pin-intro-close-btn" type="button" aria-label="Dismiss">✕</button>
                </div>
            </div>
        `);
        $('body').append($el);
        this.$el = $el;

        const close = () => {
            this.hide();
            this.onDismiss();
        };
        $el.find('.pin-intro-dismiss-btn').on('click', close);
        $el.find('.pin-intro-close-btn').on('click', close);
    }

    hide() {
        if (this.$el) {
            this.$el.remove();
            this.$el = null;
        }
    }

    get isVisible() {
        return !!this.$el;
    }
}
