import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { analyzeRepository } from './analyze.mjs';
import { compareSnapshots, findCycles, folderMatrix } from './model.js';
import { sourceReferences } from './source.mjs';

test('AST evidence distinguishes imports, re-exports, dynamic expressions and literal text', () => {
    const references = sourceReferences(`// import './comment.js';
const text = "import './string.js'";
import './actual.js';
export { value } from './actual.js';
import('./actual.js');
import(name);
require('./common.cjs');
const jsx = <div>import './jsx.js'</div>;`, 'fixture.jsx');
    assert.deepEqual(references.map(({ kind, specifier, line }) => [kind, specifier, line]), [
        ['import', './actual.js', 3], ['re-export', './actual.js', 4], ['dynamic-import', './actual.js', 5],
        ['dynamic-import', null, 6], ['require', './common.cjs', 7],
    ]);
    assert.throws(() => sourceReferences('import {', 'invalid.js'), SyntaxError);
});

test('tracked analysis resolves source evidence, globs, gaps and generated files reproducibly', async t => {
    const root = await mkdtemp(join(tmpdir(), 'caddy-ui-analysis-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    async function put(file, content) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), content); }
    await put('.gitignore', 'src/frontend/src/lib/caddyfileMode.js\n');
    await put('src/backend/src/main.js', `import './shared.js';
export * from './shared.js';
import('./shared.js');
import(target);
require('./common.cjs');
import './missing.js';
import 'not-an-installed-package';
// import './imaginary.js';
`);
    await put('src/backend/src/shared.js', "import './main.js'; export const value = 1;\n");
    await put('src/backend/src/common.cjs', "require('node:fs');\n");
    await put('src/frontend/src/main.jsx', `import './lib/caddyfileMode.js';
const locales = import.meta.glob(['./locales/*.js', '!./locales/en.js']);
const eager = import.meta.glob('./locales/en.js', { eager: true });
const invalid = import.meta.glob(expression);
const view = <p>Hello</p>;
`);
    await put('src/frontend/src/locales/en.js', 'export default {};\n');
    await put('src/frontend/src/locales/de.js', 'export default {};\n');
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=juscghwe', '-c', 'user.email=62502225+juscghwe@users.noreply.github.com', 'commit', '--no-gpg-sign', '-qm', 'test: analysis fixture']);
    const first = await analyzeRepository(root);
    assert.deepEqual(first, await analyzeRepository(root));
    const main = 'src/backend/src/main.js', shared = 'src/backend/src/shared.js';
    assert.deepEqual(first.edges.filter(edge => edge.from === main && edge.to === shared).map(edge => [edge.kind, edge.line]),
        [['import', 1], ['re-export', 2], ['dynamic-import', 3]]);
    assert.ok(first.edges.some(edge => edge.kind === 'require' && edge.to === 'node:fs' && edge.line === 1));
    assert.ok(first.edges.some(edge => edge.kind === 'glob-lazy' && edge.to.endsWith('/de.js') && edge.line === 2));
    assert.ok(!first.edges.some(edge => edge.kind === 'glob-lazy' && edge.to.endsWith('/en.js')));
    assert.ok(first.edges.some(edge => edge.kind === 'glob-eager' && edge.to.endsWith('/en.js')));
    assert.ok(first.nodes.some(node => node.kind === 'unresolved' && node.label === './missing.js'));
    assert.ok(!first.nodes.some(node => node.label.includes('imaginary')));
    assert.ok(first.diagnostics.some(item => item.message.includes('Nonliteral dynamic-import')));
    assert.ok(first.diagnostics.some(item => item.message.includes('Unsupported glob')));
    assert.deepEqual(first.staticCycles, [[main, shared]]);
    await put('src/frontend/src/lib/caddyfileMode.js', 'throw new Error("Never execute or parse generated code");\n');
    await put('src/backend/src/untracked.js', "import './main.js';\n");
    assert.deepEqual(first, await analyzeRepository(root), 'Generated and untracked files cannot alter the graph');
    await put(shared, 'export const value = 2;\n');
    const changed = await analyzeRepository(root);
    assert.equal(changed.metadata.dirty, true);
    assert.notEqual(changed.metadata.sourceHash, first.metadata.sourceHash);
    assert.deepEqual(changed.staticCycles, []);
    assert.equal(compareSnapshots(first, changed).removed.length, 1);
});

test('cycles and matrix distinguish dynamic links and repeated statements', () => {
    const nodes = ['a', 'b', 'c'].map(id => ({ id, kind: 'source', group: id === 'c' ? 'other' : 'app' }));
    const edges = [
        { from: 'a', to: 'b', kind: 'import' }, { from: 'a', to: 'b', kind: 're-export' },
        { from: 'b', to: 'a', kind: 'dynamic-import' }, { from: 'a', to: 'c', kind: 'import' },
        { from: 'c', to: 'c', kind: 'import' },
    ];
    assert.deepEqual(findCycles(nodes, edges), [['a', 'b'], ['c']]);
    assert.deepEqual(findCycles(nodes, edges.filter(edge => edge.kind !== 'dynamic-import')), [['c']]);
    assert.deepEqual(folderMatrix(nodes, edges), [
        { from: 'app', to: 'app', count: 2 }, { from: 'app', to: 'other', count: 1 }, { from: 'other', to: 'other', count: 1 },
    ]);
});

test('snapshot comparison ignores line movement but retains dependency kinds', () => {
    const before = { schemaVersion: 1, metadata: { scopes: ['app'] }, nodes: [], edges: [{ from: 'a', to: 'b', kind: 'import', specifier: './b', line: 1 }] };
    const after = structuredClone(before); after.edges[0].line = 200;
    assert.equal(compareSnapshots(before, after).added.length, 0);
    after.edges[0].kind = 'dynamic-import';
    assert.equal(compareSnapshots(before, after).added.length, 1);
    assert.equal(compareSnapshots(before, after).removed.length, 1);
    assert.throws(() => compareSnapshots({}, after), /version 1/);
    assert.throws(() => compareSnapshots({ ...before, metadata: { scopes: ['other'] } }, after), /same analysis scope/);
});
