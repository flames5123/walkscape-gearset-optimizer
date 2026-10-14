/**
 * bank-api.js — thin fetch client for the /api/bank/* endpoints. The server
 * resolves the session from the cookie, so no session_uuid is passed.
 */
async function j(url, method, body) {
    const opts = { method: method || 'GET' };
    if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${opts.method} ${url} -> ${r.status}`);
    return r.json();
}

export const bankApi = {
    list: () => j('/api/bank/layouts'),
    load: (id) => j(`/api/bank/layouts/${id}`),
    create: (name, tabs, settings) => j('/api/bank/layouts', 'POST', { name, tabs, settings }),
    update: (id, name, tabs, settings) => j(`/api/bank/layouts/${id}`, 'PUT', { name, tabs, settings }),
    remove: (id) => j(`/api/bank/layouts/${id}`, 'DELETE'),
    setShare: (id, shared) => j(`/api/bank/layouts/${id}/share`, 'POST', { shared }),
    community: (query) => j(`/api/bank/community?query=${encodeURIComponent(query || '')}`),
    communityLoad: (shareId) => j(`/api/bank/community/${shareId}`),
    copy: (shareId, name) => j(`/api/bank/community/${shareId}/copy`, 'POST', { name }),
    getItemHistory: () => j('/api/bank/item-history'),
    setItemHistory: (placements) => j('/api/bank/item-history', 'PUT', { placements }),
    getWorkingLayout: () => j('/api/bank/working-layout'),
    setWorkingLayout: (layout, currentId) => j('/api/bank/working-layout', 'PUT', { layout, currentId }),
};
