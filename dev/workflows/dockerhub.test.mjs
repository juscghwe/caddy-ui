import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { emptyHistory, repository } from '../dockerhub/collect.mjs';
import { dataBranch, publish, restore } from '../dockerhub/publish.mjs';

const sample = observedAt => ({ observedAt, pullCount: 85000 });
const history = (...samples) => ({ version: 1, repository, samples });
const day = value => new Date(`2026-10-${value}T00:17:00.000Z`);

const context = { repo: { owner: 'example', repo: 'caddy-ui' } };
async function directoryFor(t) {
    const directory = await mkdtemp(join(tmpdir(), 'dockerhub-publish-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('only an absent data branch permits initializing empty history', async t => {
    const directory = await directoryFor(t);
    const github = { rest: { git: { getRef: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } } } };
    assert.equal(await restore({ github, context, directory }), '');
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'history.json'), 'utf8')), emptyHistory());
    github.rest.git.getRef = async () => ({ data: { object: { sha: 'existing-head' } } });
    github.rest.repos = { getContent: async () => { throw Object.assign(new Error('missing history'), { status: 404 }); } };
    await assert.rejects(restore({ github, context, directory }), /missing history/);
});

test('history is restored from the captured commit, and corrupt state is not silently discarded', async t => {
    const directory = await directoryFor(t);
    let stored = JSON.stringify(history(sample(day('25').toISOString())));
    const github = { rest: {
        git: { getRef: async () => ({ data: { object: { sha: 'stored-head' } } }) },
        repos: { getContent: async ({ ref }) => {
            assert.equal(ref, 'stored-head');
            return { data: { encoding: 'base64', content: Buffer.from(stored).toString('base64') } };
        } },
    } };
    assert.equal(await restore({ github, context, directory }), 'stored-head');
    stored = '{broken';
    await assert.rejects(restore({ github, context, directory }), SyntaxError);
});

test('publishes history to an orphan data branch, then advances without force', async t => {
    const directory = await directoryFor(t);
    await writeFile(join(directory, 'history.json'), JSON.stringify(emptyHistory()));
    const calls = [];
    const git = {
        getCommit: async () => ({ data: { tree: { sha: 'old-tree' } } }),
        createTree: async args => { calls.push(['tree', args]); return { data: { sha: 'new-tree' } }; },
        createCommit: async args => { calls.push(['commit', args]); return { data: { sha: 'new-head' } }; },
        createRef: async args => { calls.push(['create', args]); },
        updateRef: async args => { calls.push(['update', args]); },
    };
    const github = { rest: { git } };
    await publish({ github, context, directory, head: '' });
    assert.deepEqual(calls.find(([name]) => name === 'tree')[1].tree.map(entry => entry.path), ['history.json']);
    assert.deepEqual(calls.find(([name]) => name === 'commit')[1].parents, []);
    assert.equal(calls.at(-1)[1].ref, `refs/heads/${dataBranch}`);
    calls.length = 0;
    await publish({ github, context, directory, head: 'old-head' });
    assert.deepEqual(calls.find(([name]) => name === 'commit')[1].parents, ['old-head']);
    assert.equal(calls.at(-1)[1].force, false);
    git.updateRef = async () => { throw new Error('ref advanced concurrently'); };
    await assert.rejects(publish({ github, context, directory, head: 'old-head' }), /advanced concurrently/);
    git.createTree = async () => ({ data: { sha: 'old-tree' } });
    calls.length = 0;
    await publish({ github, context, directory, head: 'old-head' });
    assert.equal(calls.length, 0, 'unchanged data should not create another commit');
});

test('daily workflow is isolated from application releases and supports manual runs', async () => {
    const workflow = parse(await readFile(new URL('../../.github/workflows/dockerhub-pulls.yml', import.meta.url), 'utf8'));
    assert.equal(workflow.on.schedule[0].cron, '17 0 * * *');
    assert('workflow_dispatch' in workflow.on);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.equal(workflow.jobs.collect.permissions.contents, 'write');
    assert.match(workflow.jobs.collect.if, /workflow_dispatch/);
    assert.equal(workflow.jobs.collect.steps.find(step => step.uses?.startsWith('actions/checkout')).with['persist-credentials'], false);
    assert(!workflow.on.push && !workflow.on.pull_request);
});
