import { useState } from 'react';
import { compareSnapshots, findCycles, folderMatrix } from './model.js';

const label = id => id.replace(/^src\/(backend|frontend)\/src\//, '$1/');
const link = id => '#' + new URLSearchParams({ module: id });

export function Cycles({ nodes, edges }) {
    const cycles = findCycles(nodes, edges);
    return <section><h2>Cyclic dependency groups</h2><p className="hint">{cycles.length} groups for the selected relationship kinds. Select “Static only” to exclude lazy imports. A cycle is a review lead; it does not establish a runtime failure.</p>
        {!cycles.length && <p>No cycles in this view.</p>}
        {cycles.map((members, i) => <article className="analysis-card" key={members[0]}><h3>Group {i + 1} <span className="count">{members.length} modules</span></h3>
            <ul>{members.map(id => <li key={id}><a href={link(id)}>{label(id)}</a></li>)}</ul>
            <p className="hint">Following imports can reach every other module in this group. Open a module to inspect the contributing source lines.</p>
        </article>)}
    </section>;
}

export function Matrix({ nodes, edges }) {
    const [selection, setSelection] = useState(null);
    const groups = [...new Set(nodes.filter(node => node.kind === 'source').map(node => node.group))].sort();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const cells = folderMatrix(nodes, edges);
    const matching = selection && edges.filter(edge => byId.get(edge.from)?.group === selection.from && byId.get(edge.to)?.group === selection.to);
    return <section><h2>Folder dependency matrix</h2><p className="hint">Rows import columns. Counts represent unique module pairs, including dependencies within the same folder. Select a count to inspect its references.</p>
        <div className="table-scroll"><table className="matrix"><thead><tr><th>Importer ↓ / dependency →</th>{groups.map(group => <th key={group}>{group}</th>)}</tr></thead>
            <tbody>{groups.map(from => <tr key={from}><th>{from}</th>{groups.map(to => {
                const cell = cells.find(cell => cell.from === from && cell.to === to);
                return <td key={to}>{cell ? <button aria-label={`${from} imports ${to}: ${cell.count} module pairs`} onClick={() => setSelection(cell)}>{cell.count}</button> : <span className="hint">—</span>}</td>;
            })}</tr>)}</tbody></table></div>
        {selection && <><h3>{selection.from} → {selection.to}</h3><ul className="reference-list">{matching.map((edge, i) => <li key={i}>
            <a href={link(edge.from)}>{label(edge.from)}:{edge.line ?? '?'}</a> → <a href={link(edge.to)}>{label(edge.to)}</a> <span className="badge">{edge.kind}</span>
        </li>)}</ul>{!matching.length && <p>No matching references for the current filter.</p>}</>}
    </section>;
}

export function Comparison({ snapshot }) {
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [baseline, setBaseline] = useState(null);
    async function load(file) {
        if (!file) return;
        setResult(null); setError(''); setBaseline(null);
        try {
            const previous = JSON.parse(await file.text());
            setResult(compareSnapshots(previous, snapshot));
            setBaseline(previous.metadata);
        } catch (cause) { setError(cause.message); }
    }
    return <section><h2>Compare snapshots</h2><p className="hint">Choose an earlier downloaded JSON snapshot. Compare distinct importer / dependency / kind / specifier relationships. Moving source lines or repeating an existing import does not create a dependency change. Comparison uses full snapshots regardless of sidebar filters. Files stay in your browser.</p>
        <label className="file-label">Baseline snapshot<input type="file" accept=".json,application/json" onChange={event => void load(event.target.files[0])} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        {result && <><p>Baseline <code>{baseline.commit?.slice(0, 12) || 'unknown commit'}</code>{baseline.dirty ? ' (modified sources)' : ''} → current snapshot</p>
            {JSON.stringify(baseline.tools) !== JSON.stringify(snapshot.metadata.tools) && <p className="notice">Analyzer versions differ. Some changes may reflect analysis behavior rather than source edits.</p>}
            <p className="comparison-summary">{result.added.length} added relationships · {result.removed.length} removed relationships · {result.addedModules.length} added modules · {result.removedModules.length} removed modules</p>
            {['added', 'removed'].map(kind => <div key={kind}><h3>{kind === 'added' ? 'Added relationships' : 'Removed relationships'}</h3>
                {!result[kind].length ? <p className="hint">None.</p> : <ul className="reference-list">{result[kind].map((edge, i) => <li key={i}>
                    <a href={link(edge.from)}>{label(edge.from)}</a> → {label(edge.to)} <span className="badge">{edge.kind}</span>
                </li>)}</ul>}</div>)}
            {['addedModules', 'removedModules'].map(kind => result[kind].length > 0 && <div key={kind}><h3>{kind === 'addedModules' ? 'Added modules' : 'Removed modules'}</h3><ul>{result[kind].map(node => <li key={node.id}>{label(node.id)}</li>)}</ul></div>)}
        </>}
    </section>;
}

export function Diagnostics({ snapshot }) {
    return <section><h2>Analysis diagnostics</h2><p className="hint">Unknown targets stay visible. A clean report means the supported syntax was resolved; it does not prove runtime completeness.</p>
        {!snapshot.diagnostics.length && <p>No unresolved or unsupported references in this snapshot.</p>}
        <ul className="reference-list">{snapshot.diagnostics.map((item, i) => <li key={i}><a href={link(item.file)}>{label(item.file)}:{item.line ?? '?'}</a><p>{item.message}</p>{item.excerpt && <code>{item.excerpt}</code>}</li>)}</ul>
        <h3>Generated modules</h3><ul>{snapshot.nodes.filter(node => node.kind === 'generated').map(node => <li key={node.id}><a href={link(node.id)}>{label(node.id)}</a><p className="hint">{node.reason}</p></li>)}</ul>
    </section>;
}
