/**
 * UndoRedoButtons Component
 * 
 * Displays undo/redo buttons in the bottom right corner.
 * 
 * Features:
 * - Fixed position in bottom right
 * - Disabled state when no undo/redo available
 * - Tooltips showing keyboard shortcuts
 * - Integrates with UndoRedoManager
 */

import Component from './base.js';
import undoRedoManager from '../undo-redo.js';

class UndoRedoButtons extends Component {
    /**
     * Create undo/redo buttons component
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        this.render();
        this.attachEvents();

        // Update button states initially
        undoRedoManager.updateButtons();
    }

    /**
     * Render the component
     */
    render() {
        const html = `
            <div class="undo-redo-buttons">
                <button 
                    id="undo-btn" 
                    class="undo-redo-button" 
                    title="Undo (Ctrl/Cmd+Z)"
                    disabled
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 7v6h6"/>
                        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
                    </svg>
                </button>
                <button 
                    id="redo-btn" 
                    class="undo-redo-button" 
                    title="Redo (Ctrl/Cmd+Shift+Z)"
                    disabled
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 7v6h-6"/>
                        <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/>
                    </svg>
                </button>
            </div>
        `;

        this.$element.html(html);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Undo button click
        this.$element.on('click', '#undo-btn', () => {
            undoRedoManager.undo();
        });

        // Redo button click
        this.$element.on('click', '#redo-btn', () => {
            undoRedoManager.redo();
        });
    }
}

export default UndoRedoButtons;
