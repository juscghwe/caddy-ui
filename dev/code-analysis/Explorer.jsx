import { useEffect, useState } from 'react';
import snapshot from './generated/analysis.json';
import { dynamicKinds } from './model.js';
import './explorer.css';

const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
const short = id => id.replace(/^src\/(backend|frontend)\/src\//, '$1/');
const link = id => '#' + new URLSearchParams({ module: id });
const selectedFromUrl = () => new URLSearchParams(location.hash.slice(1)).get('module') || 'src/backend/src/routes/logs.js';

function download(value, name, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ModuleLink({ id }) {
    return <a href={link(id)} title={id}>{short(byId.get(id)?.label || id)}</a>;
}

function Neighborhood({ selected, edges }) {
    const incoming = [...new Set(edges.filter(edge => edge.to === selected).map(edge => edge.from))].sort();
    const outgoing = [...new Set(edges.filter(edge => edge.from === selected).map(edge => edge.to))].sort();
    const limit = 24;
    const left = incoming.slice(0, limit), right = outgoing.slice(0, limit);
    const height = Math.max(left.length, right.length, 1) * 46 + 100;
    const center = height / 2;
    const positions = new Map([[selected, [370, center]]]);
    left.forEach((id, i) => { if (id !== selected) positions.set('left:' + id, [10, i * 46 + 65]); });
    right.forEach((id, i) => { if (id !== selected) positions.set('right:' + id, [730, i * 46 + 65]); });
    const related = edges.filter(edge => (edge.to === selected && left.includes(edge.from)) || (edge.from === selected && right.includes(edge.to)));
    return <>
        <p className="hint">Arrows point from importer to dependency. Dashed lines are dynamic. Select a module to explore it.</p>
        <div className="graph-scroll"><svg viewBox={`0 0 1070 ${height}`} width="1070" height={height} aria-label="Direct dependency neighborhood" role="group">
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#7c9ab6" /></marker></defs>
            <text x="10" y="25" className="graph-heading">IMPORTED BY · {incoming.length} modules</text>
            <text x="730" y="25" className="graph-heading">DEPENDS ON · {outgoing.length} modules</text>
            {related.map((edge, i) => {
                const start = edge.from === selected ? positions.get(selected) : positions.get('left:' + edge.from);
                const end = edge.to === selected ? positions.get(selected) : positions.get('right:' + edge.to);
                if (!start || !end) return null;
                return <path key={i} d={`M${start[0] + 320} ${start[1] + 16} C${start[0] + 345} ${start[1] + 16},${end[0] - 25} ${end[1] + 16},${end[0]} ${end[1] + 16}`}
                    className={dynamicKinds.includes(edge.kind) ? 'edge dynamic' : 'edge'} markerEnd="url(#arrow)"><title>{edge.kind} · {edge.from}:{edge.line ?? '?'} → {edge.to}</title></path>;
            })}
            {[...positions].map(([key, [x, y]]) => {
                const id = key.replace(/^(?:left|right):/, '');
                const node = byId.get(id);
                const label = short(node?.label || id);
                return <a key={key} href={link(id)} aria-label={id}>
                    <title>{id}</title><rect x={x} y={y} width="320" height="32" rx="6" className={id === selected ? 'node selected' : `node ${node?.kind}`} />
                    <text x={x + 10} y={y + 21}>{label.length > 42 ? '…' + label.slice(-41) : label}</text>
                </a>;
            })}
        </svg></div>
        {(incoming.length > limit || outgoing.length > limit) && <p className="hint">Diagram shows up to {limit} neighbors per side. The tables below include every matching reference.</p>}
    </>;
}

function ReferenceTable({ title, edges, incoming = false }) {
    return <section><h3>{title} <span className="count">{edges.length} references</span></h3>
        {!edges.length ? <p className="hint">No matching references.</p> : <div className="table-scroll"><table>
            <thead><tr><th>Module</th><th>Kind</th><th>Source evidence</th></tr></thead>
            <tbody>{edges.map((edge, i) => <tr key={i}>
                <td><ModuleLink id={incoming ? edge.from : edge.to} /></td><td><span className="badge">{edge.kind}</span></td>
                <td><div className="location">{short(edge.from)}:{edge.line ?? '?'}</div><code>{edge.excerpt || 'No source location available'}</code></td>
            </tr>)}</tbody>
        </table></div>}
    </section>;
}

export default function Explorer() {
    const [selected, setSelected] = useState(selectedFromUrl);
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState('all');
    const [mode, setMode] = useState('all');
    const [external, setExternal] = useState(false);
    useEffect(() => {
        const navigate = () => setSelected(selectedFromUrl());
        window.addEventListener('hashchange', navigate);
        return () => window.removeEventListener('hashchange', navigate);
    }, []);
    const node = byId.get(selected);
    const edges = snapshot.edges.filter(edge => mode === 'all' || (mode === 'dynamic') === dynamicKinds.includes(edge.kind))
        .filter(edge => external || !['package', 'builtin', 'asset'].includes(byId.get(edge.to)?.kind));
    const modules = snapshot.nodes.filter(node => (external || !['package', 'builtin', 'asset'].includes(node.kind))
        && (scope === 'all' || node.id.startsWith(`src/${scope}/`)) && node.label.toLowerCase().includes(query.toLowerCase()));
    const incoming = edges.filter(edge => edge.to === selected), outgoing = edges.filter(edge => edge.from === selected);
    return <div className="app">
        <header><div><div className="eyebrow">CADDY UI · REFACTOR WORKBENCH</div><h1>Code relationships</h1>
            <p>Explore module dependencies with source evidence.</p></div>
            <button onClick={() => download(JSON.stringify(snapshot, null, 2) + '\n', `caddy-ui-analysis-${snapshot.metadata.commit.slice(0, 8)}.json`)}>Download snapshot</button>
        </header>
        <div className="provenance"><span>Commit <code>{snapshot.metadata.commit.slice(0, 12)}</code>{snapshot.metadata.dirty ? ' · modified application sources' : ' · clean application sources'}</span>
            <span>{snapshot.nodes.filter(node => node.kind === 'source').length} modules · {snapshot.edges.length} references · {snapshot.cycles.length} cyclic groups · {snapshot.diagnostics.length} diagnostics</span></div>
        <div className="workspace"><aside>
            <label>Find a module<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="File name or path" /></label>
            <label>Application<select aria-label="Application" value={scope} onChange={event => setScope(event.target.value)}><option value="all">Both services</option><option value="backend">Backend</option><option value="frontend">Frontend</option></select></label>
            <label>Relationships<select aria-label="Relationships" value={mode} onChange={event => setMode(event.target.value)}><option value="all">All kinds</option><option value="static">Static only</option><option value="dynamic">Dynamic only</option></select></label>
            <label className="checkbox"><input type="checkbox" checked={external} onChange={event => setExternal(event.target.checked)} />Include packages, built-ins and assets</label>
            <div className="hint">{modules.length} modules shown</div>
            <nav aria-label="Modules">{modules.map(module => <a key={module.id} href={link(module.id)} aria-current={selected === module.id ? 'page' : undefined}>
                <span>{short(module.label)}</span>{module.kind !== 'source' && <small>{module.kind}</small>}
            </a>)}</nav>
        </aside>
        <main>{!node ? <p role="alert">This module is not in the snapshot. Select one from the list.</p> : <>
            <div className="eyebrow">{node.group} · {node.kind}</div><h2>{short(node.label)}</h2><p className="path">{node.id}</p>
            {node.reason && <p className="notice">{node.reason}</p>}
            {(node.kind === 'unresolved' || node.unresolved) && <p className="notice">This dependency could not be resolved. It remains visible so it cannot be mistaken for an unused module.</p>}
            <Neighborhood selected={selected} edges={edges} />
            <ReferenceTable title="Dependencies" edges={outgoing} />
            <ReferenceTable title="Imported by" edges={incoming} incoming />
        </>}
        <details className="limitations"><summary>Scope and limitations</summary><ul>{snapshot.metadata.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            <p>Source fingerprint: <code>{snapshot.metadata.sourceHash}</code></p><p>Regenerate with <code>npm run analysis:generate</code> after source changes. Newly created files must be staged or committed to enter the scope.</p></details>
        </main></div>
    </div>;
}

