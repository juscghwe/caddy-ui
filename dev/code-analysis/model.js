export const dynamicKinds = ['dynamic-import', 'glob-lazy'];
export const edgeKey = edge => JSON.stringify([edge.from, edge.to, edge.kind, edge.specifier]);

// Strongly connected components describe mutually dependent groups, not just
// whichever single circular path happened to be discovered first.
export function findCycles(nodes, edges) {
    const adjacency = new Map(nodes.filter(node => node.kind === 'source').map(node => [node.id, new Set()]));
    for (const edge of edges) if (adjacency.has(edge.from) && adjacency.has(edge.to)) adjacency.get(edge.from).add(edge.to);
    let index = 0;
    const indices = new Map(), low = new Map(), stack = [], pending = new Set(), cycles = [];
    function visit(id) {
        indices.set(id, index); low.set(id, index++); stack.push(id); pending.add(id);
        for (const next of adjacency.get(id)) {
            if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
            else if (pending.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
        }
        if (low.get(id) !== indices.get(id)) return;
        const members = [];
        let member;
        do { member = stack.pop(); pending.delete(member); members.push(member); } while (member !== id);
        if (members.length > 1 || adjacency.get(id).has(id)) cycles.push(members.sort());
    }
    for (const id of adjacency.keys()) if (!indices.has(id)) visit(id);
    return cycles.sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

export function folderMatrix(nodes, edges) {
    const groups = new Map(nodes.filter(node => node.kind === 'source').map(node => [node.id, node.group]));
    const pairs = new Map();
    for (const edge of edges) {
        if (!groups.has(edge.from) || !groups.has(edge.to)) continue;
        const from = groups.get(edge.from), to = groups.get(edge.to), key = JSON.stringify([from, to]);
        if (!pairs.has(key)) pairs.set(key, { from, to, modules: new Set() });
        pairs.get(key).modules.add(JSON.stringify([edge.from, edge.to]));
    }
    return [...pairs.values()].map(({ from, to, modules }) => ({ from, to, count: modules.size }))
        .sort((a, b) => a.from.localeCompare(b.from, 'en') || a.to.localeCompare(b.to, 'en'));
}

export function compareSnapshots(before, after) {
    if (before.schemaVersion !== 1 || after.schemaVersion !== 1 || !Array.isArray(before.edges) || !Array.isArray(before.nodes)) throw new Error('Select a version 1 analysis JSON snapshot.');
    if (JSON.stringify(before.metadata.scopes) !== JSON.stringify(after.metadata.scopes)) throw new Error('Snapshots must use the same analysis scope.');
    const previous = new Map(before.edges.map(edge => [edgeKey(edge), edge]));
    const current = new Map(after.edges.map(edge => [edgeKey(edge), edge]));
    return {
        added: [...current].filter(([key]) => !previous.has(key)).map(([, edge]) => edge),
        removed: [...previous].filter(([key]) => !current.has(key)).map(([, edge]) => edge),
        addedModules: after.nodes.filter(node => node.kind === 'source' && !before.nodes.some(previous => previous.id === node.id)),
        removedModules: before.nodes.filter(node => node.kind === 'source' && !after.nodes.some(current => current.id === node.id)),
    };
}
