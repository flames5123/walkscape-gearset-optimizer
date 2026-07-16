/**
 * TreeOverview — Compact minimap of the entire crafting tree.
 * 
 * Shows all nodes with item icons, source type icons, names, and step counts.
 * Click-to-navigate scrolls the main view to the clicked node.
 */

import Component from './base.js';

import { formatFixed } from '../utils/number-format.js';

const SOURCE_ICON_PATHS = {
    recipe: '/assets/icons/attributes/work_efficiency.svg',
    activity: '/assets/icons/text/skill_icons/agility.svg',
    chest: '/assets/icons/items/containers/treasure_chest.svg',
    // bank/shop deliberately omitted — their coin icon is redundant in
    // the Tree Overview row (the steps/qty columns already convey that
    // the node resolves to a purchase).
};

class TreeOverview extends Component {
    constructor(element, props = {}) {
        super(element, props);
        // props: { nodes, onNodeClick, optimizationStatus }
        this.render();
        this.attachEvents();
    }

    render() {
        const { nodes = [] } = this.props;
        if (!nodes.length) {
            this.$element.html('<div class="tree-overview-empty">No tree loaded</div>');
            return '';
        }

        const root = nodes.find(n => !n.parent_id);
        if (!root) {
            this.$element.html('');
            return '';
        }

        const html = `
            <div class="tree-overview">
                <div class="tree-overview-header">
                    <button class="button ct-palette-btn" title="Section theme colors"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 347.523 347.523" fill="white"><path d="M108.674,196.125c-2.857-0.402-5.777-0.592-8.746-0.534c-14.267,0.278-36.342,6.092-60.493,32.207c-19.171,20.729-19.954,42.635-20.644,61.961c-0.66,18.474-1.181,33.065-16.507,43.727c-1.506,1.049-2.318,2.837-2.113,4.661c0.128,1.147,0.645,2.191,1.434,2.98c0.466,0.466,1.026,0.843,1.658,1.099c28.523,11.553,77.316,5.895,117.044-33.833c18.043-18.044,28.812-37.145,31.14-55.233c0.607-4.719,0.618-9.323,0.091-13.763L108.674,196.125z M100.915,229.382c-1.553,2.174-3.859,3.612-6.494,4.052c-19.209,3.202-25.884,15.953-26.159,16.494c-1.627,3.387-5.167,5.611-8.989,5.611c-0.337,0-0.676-0.017-1.015-0.052c-1.149-0.117-2.264-0.432-3.313-0.936c-4.97-2.391-7.069-8.376-4.681-13.347c0.442-0.918,11.153-22.546,40.869-27.5c0.546-0.09,1.1-0.136,1.647-0.136c4.908,0,9.055,3.516,9.861,8.357C103.08,224.559,102.467,227.207,100.915,229.382z"/><path d="M340.587,6.796c-8.615-8.614-22.425-9.1-31.624-1.112c-5.782,5.021-141.818,123.166-160.166,141.513c-9.175,9.175-20.946,24.898-31.124,39.428l42.864,43.271c14.546-10.18,30.345-22.003,39.65-31.308C218.749,180.024,336.69,44.193,341.703,38.42C349.688,29.22,349.201,15.41,340.587,6.796z"/></svg></button>
                    <div class="tree-overview-title">Tree Overview</div>
                </div>
                <div class="tree-overview-nodes">
                    ${this._renderNode(root, nodes, 0)}
                </div>
            </div>
        `;
        this.$element.html(html);
        return html;
    }

    _renderNode(node, allNodes, depth) {
        const children = allNodes.filter(n => n.parent_id === node.node_id);
        const status = this._getOptStatus(node.node_id);
        const statusClass = status === 'complete' ? 'opt-complete' :
            status === 'running' ? 'opt-running' : '';

        const sourceIcon = SOURCE_ICON_PATHS[node.source_type] || SOURCE_ICON_PATHS.bank;
        const itemIcon = node.icon_path || '';

        // Steps display
        const metrics = node.metrics || {};
        const steps = metrics.steps_per_item;
        let stepsHtml = '';
        if (steps != null && steps !== Infinity && steps > 0) {
            stepsHtml = `<span class="tree-overview-steps">${formatFixed(steps, 1)}</span>`;
        } else if (steps === 0) {
            stepsHtml = `<span class="tree-overview-steps tree-overview-steps-bank">bank</span>`;
        }

        // Material Options block in the overview (user spec 2026-05-15):
        // when the parent card is showing the chip selector AND no
        // chip preview is committed yet, list every option below the
        // node row, indented, with a 32x32 icon + slightly gray italic
        // text. Click "Material options" header = scroll to the card's
        // material options. Click an option = scroll + activate that
        // chip's preview. Mirrors _getDisplayedLeafMaterials() in
        // tree-node-card.js: visible only when source=best AND not
        // bestComputed AND 2+ leaf_materials AND no preview committed.
        const showMaterialOptions = (
            node.source_type === 'best'
            && !node.best_pick_computed
            && (node.leaf_materials || []).length >= 2
            && !node._mo_preview_chip
        );
        let materialOptionsHtml = '';
        if (showMaterialOptions) {
            // The Material Options block sits one logical depth below
            // the parent row (it represents the chip-picker children),
            // so each row inside picks up the NEXT depth-palette
            // color via --glow-color (mirrors the parent row's
            // pattern). The block sets --glow-color once and the
            // child rows inherit it through the CSS cascade so the
            // .tree-overview-side-glow inside each row reads it as if
            // it were on a normal tree-overview-node.
            const moColorIdx = Math.min(depth + 1, 7);
            // Each row inside renders its own .tree-overview-side-glow
            // span — same pattern as .tree-overview-node — so the
            // 5px colored stripe + hover halo is consistent with the
            // rest of the overview rows.
            const moHeaderHtml = `
                <div class="tree-overview-mo-header" data-node-id="${node.node_id}"
                     style="margin-left: ${depth * 16 + 12}px; padding-left: 12px;">
                    <span class="tree-overview-side-glow" aria-hidden="true"></span>
                    Material options
                </div>
            `;
            const optionsList = (node.leaf_materials || []).map(opt => {
                const sid = String(opt.source_id || '').replace(/"/g, '&quot;');
                const mgi = opt.material_group_index == null ? '' : String(opt.material_group_index);
                const optIcon = opt.icon || '';
                const label = String(opt.label || '').replace(/</g, '&lt;');
                return `
                    <div class="tree-overview-mo-option"
                         data-node-id="${node.node_id}"
                         data-source-id="${sid}"
                         data-material-group-index="${mgi}"
                         style="margin-left: ${depth * 16 + 12}px; padding-left: 18px;">
                        <span class="tree-overview-side-glow" aria-hidden="true"></span>
                        ${optIcon ? `<img src="${optIcon}" class="tree-overview-mo-icon" alt="" onerror="this.style.display='none'">` : ''}
                        <span class="tree-overview-mo-label">${label}</span>
                    </div>
                `;
            }).join('');
            materialOptionsHtml = `
                <div class="tree-overview-mo-block" data-node-id="${node.node_id}"
                     style="--glow-color: var(--ct-depth-color-${moColorIdx});">
                    ${moHeaderHtml}
                    ${optionsList}
                </div>
            `;
        }

        // Depth palette for the overview side glow: each depth maps
        // straight to its own color (depth 0 → color-0, depth 1 → color-1,
        // depth 2 → color-2, …), capped at 7 since the palette only has
        // 8 slots. The colored stripe is a separate positioned element
        // (`.tree-overview-side-glow`) so we can animate a leftward
        // box-shadow glow on row hover — same pattern the detailed tree
        // cards use via `.tree-node-side-collapse`. Color is passed via
        // a CSS custom property so the glow's background AND hover
        // shadow stay paired and status overrides (opt-complete /
        // opt-running) can swap it with a single --glow-color rule.
        const colorIdx = Math.min(depth, 7);
        return `
            <div class="tree-overview-node ${statusClass}" 
                 data-node-id="${node.node_id}"
                 data-depth="${depth}"
                 style="margin-left: ${depth * 16}px; padding-left: 12px; --glow-color: var(--ct-depth-color-${colorIdx});">
                <span class="tree-overview-side-glow" aria-hidden="true"></span>
                ${itemIcon ? `<img src="${itemIcon}" class="tree-overview-item-icon" alt="" onerror="this.style.display='none'">` : ''}
                ${sourceIcon ? `<img src="${sourceIcon}" class="tree-overview-source-icon" alt="" onerror="this.style.display='none'">` : ''}                <span class="tree-overview-label">${node.item_name}</span>
                <span class="tree-overview-qty">×${node.base_requirement_amount}</span>
                ${stepsHtml}
            </div>
            ${materialOptionsHtml}
            ${showMaterialOptions ? '' : children.map(c => this._renderNode(c, allNodes, depth + 1)).join('')}
        `;
    }

    _getOptStatus(nodeId) {
        const status = this.props.optimizationStatus || {};
        const completed = status.completed_nodes || [];
        if (completed.find(n => n.node_id === nodeId)) return 'complete';
        if (status.status === 'running') return 'running';
        return '';
    }

    updateStatus(nodeId, status) {
        const el = this.$element.find(`[data-node-id="${nodeId}"]`);
        el.removeClass('opt-complete opt-running');
        if (status) el.addClass(`opt-${status}`);
    }

    attachEvents() {
        const self = this;
        this.$element.on('click', '.tree-overview-node', function () {
            const nodeId = $(this).data('node-id');
            if (self.props.onNodeClick) {
                self.props.onNodeClick(nodeId);
            }
        });
        // Material options block — header click scrolls to the
        // parent's chip area; option click scrolls + activates that
        // chip's preview. Both delegate to the parent via callbacks
        // so CraftingTreeView owns the scroll + state mutation.
        this.$element.on('click', '.tree-overview-mo-header', function (e) {
            e.stopPropagation();
            const nodeId = $(this).data('node-id');
            if (self.props.onMaterialOptionsHeaderClick) {
                self.props.onMaterialOptionsHeaderClick(nodeId);
            } else if (self.props.onNodeClick) {
                self.props.onNodeClick(nodeId);
            }
        });
        this.$element.on('click', '.tree-overview-mo-option', function (e) {
            e.stopPropagation();
            const $opt = $(this);
            const nodeId = $opt.data('node-id');
            const sid = String($opt.data('source-id') || '');
            const mgiRaw = $opt.data('material-group-index');
            const mgi = (mgiRaw === '' || mgiRaw == null) ? 0 : parseInt(mgiRaw, 10);
            if (self.props.onMaterialOptionPreview) {
                self.props.onMaterialOptionPreview(nodeId, `${sid}::${mgi}`);
            } else if (self.props.onNodeClick) {
                self.props.onNodeClick(nodeId);
            }
        });
    }

    destroy() {
        this.$element.off('click');
        super.destroy();
    }
}

export default TreeOverview;
