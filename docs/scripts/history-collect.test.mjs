import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHistory, matchingCollection } from './history-collect.mjs';

const request = 'docs-archive-123-2';
const run = overrides => ({ id: 42, event: 'workflow_dispatch', head_branch: 'main', display_title: request,
    status: 'completed', conclusion: 'success', ...overrides });

test('release collection dispatches once and waits for its own fork request rather than another successful run', async () => {
    const calls = [], messages = [];
    const responses = [
        [run({ display_title: 'unrelated manual crawl' })],
        [run({ status: 'queued', conclusion: null })],
        [run({ status: 'in_progress', conclusion: null })],
        [run()],
    ];
    let pauses = 0;
    const id = await collectHistory({ repository: 'juscghwe/caddy-ui', request, notify: message => messages.push(message),
        sleep: async () => { pauses++; }, execute: async (command, args, options) => {
            calls.push({ command, args });
            assert.equal(options.timeout, 30000);
            assert(options.signal instanceof AbortSignal);
            return { stdout: args.includes('POST') ? '' : JSON.stringify({ workflow_runs: responses.shift() }) };
        } });
    assert.equal(id, 42);
    assert.equal(pauses, 3);
    assert.equal(calls.filter(call => call.args.includes('POST')).length, 1);
    assert.deepEqual(calls[0], { command: 'gh', args: ['api', '--method', 'POST',
        'repos/juscghwe/caddy-ui/actions/workflows/docs.yml/dispatches', '-f', 'ref=main',
        '-f', 'inputs[archive_history]=true', '-f', `inputs[archive_request]=${request}`] });
    assert(calls.slice(1).every(call => call.args[1].endsWith('runs?event=workflow_dispatch&branch=main&per_page=100')));
    assert(messages.at(-1).includes('https://github.com/juscghwe/caddy-ui/actions/runs/42'));
});

test('matching rejects foreign events/branches, invalid responses and duplicate request IDs', () => {
    assert.equal(matchingCollection([run({ event: 'push' }), run({ head_branch: 'feature' })], request), undefined);
    assert.throws(() => matchingCollection(undefined, request), /Invalid/);
    assert.throws(() => matchingCollection([run(), run({ id: 43 })], request), /Multiple/);
});

test('failed, cancelled or skipped fork runs stop publication instead of accepting another run', async () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) {
        await assert.rejects(collectHistory({ repository: 'juscghwe/caddy-ui', request, notify: () => {},
            execute: async (command, args) => ({ stdout: args.includes('POST') ? ''
                : JSON.stringify({ workflow_runs: [run({ display_title: 'other' }), run({ conclusion })] }) }),
        }), /Archive collection .*https:\/\/github.com\/juscghwe\/caddy-ui\/actions\/runs\/42/);
    }
});

test('dispatch/access errors are not retried or treated as an empty successful collection', async () => {
    let calls = 0;
    await assert.rejects(collectHistory({ repository: 'juscghwe/caddy-ui', request, execute: async () => {
        calls++; throw new Error('Dispatch denied');
    } }), /Dispatch denied/);
    assert.equal(calls, 1);
    await assert.rejects(collectHistory({ repository: 'juscghwe/caddy-ui', request, notify: () => {}, execute: async (command, args) => {
        if (!args.includes('POST')) throw new Error('Run lookup denied');
        return { stdout: '' };
    } }), /Run lookup denied/);
});

test('an absent run has a bounded wait and cancellation stops polling without redispatching', async () => {
    let dispatches = 0;
    const execute = async (command, args) => {
        if (args.includes('POST')) dispatches++;
        return { stdout: args.includes('POST') ? '' : JSON.stringify({ workflow_runs: [] }) };
    };
    await assert.rejects(collectHistory({ repository: 'juscghwe/caddy-ui', request, timeoutMs: 20, pollMs: 5,
        execute, notify: () => {} }), /Timed out waiting/);
    assert.equal(dispatches, 1);
    const controller = new AbortController();
    await assert.rejects(collectHistory({ repository: 'juscghwe/caddy-ui', request, execute, signal: controller.signal,
        notify: () => {}, sleep: async () => { controller.abort(new Error('Stopped')); },
    }), /Stopped/);
    assert.equal(dispatches, 2);
});

test('invalid dispatch arguments fail before invoking GitHub', async () => {
    for (const [repository, value] of [['../other', request], ['juscghwe/caddy-ui', 'untracked-request']]) {
        await assert.rejects(collectHistory({ repository, request: value,
            execute: async () => { assert.fail('Must not contact GitHub'); } }), /Expected/);
    }
});
