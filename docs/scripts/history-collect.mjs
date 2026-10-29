import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { options } from './history-inventory.mjs';

const exec = promisify(execFile);

// The request ID is the fork workflow's display title. Match that exact title,
// not the newest run: unrelated manual requests may overlap this release.
export function matchingCollection(runs, request) {
    if (!Array.isArray(runs)) throw new Error('Invalid archive workflow run response');
    const matching = runs.filter(run => run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.display_title === request);
    if (matching.length > 1) throw new Error(`Multiple archive runs match ${request}`);
    return matching[0];
}

export async function collectHistory({ repository, request, timeoutMs = 95 * 60 * 1000, pollMs = 15000,
    execute = exec, sleep = delay, signal, notify = console.log }) {
    if (!/^[A-Za-z0-9-]+\/(?!\.{1,2}$)[\w.-]+$/.test(repository || '')) throw new Error('Expected an explicit archive owner/repository');
    if (!/^docs-archive-\d+-\d+$/.test(request || '')) throw new Error('Expected a docs-archive-<run ID>-<attempt> request ID');
    const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const api = async args => {
        bounded.throwIfAborted();
        return (await execute('gh', ['api', ...args], { signal: bounded, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    };
    // Dispatch exactly once. A failed/ambiguous response is not retried, since
    // GitHub may already have accepted the request.
    await api(['--method', 'POST', `repos/${repository}/actions/workflows/docs.yml/dispatches`,
        '-f', 'ref=main', '-f', 'inputs[archive_history]=true', '-f', `inputs[archive_request]=${request}`]);
    notify(`Requested archive collection: ${request}`);
    let previous;
    try {
        while (true) {
            const response = JSON.parse(await api([`repos/${repository}/actions/workflows/docs.yml/runs?event=workflow_dispatch&branch=main&per_page=100`]));
            const run = matchingCollection(response.workflow_runs, request);
            if (run) {
                if (!Number.isSafeInteger(run.id) || !['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(run.status)) {
                    throw new Error('Invalid matching archive workflow run');
                }
                const url = `https://github.com/${repository}/actions/runs/${run.id}`;
                if (previous !== run.status) notify(`Archive collection ${run.status}: ${url}`);
                previous = run.status;
                if (run.status === 'completed') {
                    if (run.conclusion !== 'success') throw new Error(`Archive collection ${run.conclusion || 'did not succeed'}: ${url}`);
                    return run.id;
                }
            }
            await sleep(pollMs, undefined, { signal: bounded });
        }
    } catch (error) {
        signal?.throwIfAborted();
        if (bounded.aborted) throw new Error(`Timed out waiting for archive collection ${request}`, { cause: error });
        throw error;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Collection wait interrupted'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        const args = options(process.argv.slice(2), ['repository', 'request']);
        await collectHistory({ repository: args.repository, request: args.request, signal: controller.signal });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
