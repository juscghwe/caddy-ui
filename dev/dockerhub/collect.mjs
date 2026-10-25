import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = 'zackwag/caddy-ui-backend';
export const emptyHistory = () => ({ version: 1, repository, samples: [] });

export function validateHistory(history) {
    if (history?.version !== 1 || history.repository !== repository || !Array.isArray(history.samples)) throw new Error('Unsupported pull history');
    let previousDay = '';
    for (const sample of history.samples) {
        const timestamp = sample?.observedAt;
        if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) ||
            new Date(timestamp).toISOString() !== timestamp) throw new Error('Invalid observation timestamp');
        const day = timestamp.slice(0, 10);
        if (day <= previousDay) throw new Error('Pull history must have one observation per day in chronological order');
        previousDay = day;
        if (!Number.isSafeInteger(sample.pullCount) || sample.pullCount < 0) {
            throw new Error('Invalid stored pull count');
        }
    }
    return history;
}

export async function collect(history, { fetchImpl = fetch, now = new Date() } = {}) {
    validateHistory(history);
    const response = await fetchImpl(`https://hub.docker.com/v2/repositories/${repository}/`, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Docker Hub returned HTTP ${response.status} for ${repository}`);
    }
    const value = await response.json();
    if (!Number.isSafeInteger(value.pull_count) || value.pull_count < 0) {
        throw new Error(`Docker Hub returned an invalid pull count for ${repository}`);
    }
    const sample = { observedAt: now.toISOString(), pullCount: value.pull_count };
    const samples = [...history.samples];
    const last = samples.at(-1);
    if (last && last.observedAt > sample.observedAt) throw new Error('Observation predates the latest stored sample');
    if (last?.observedAt.slice(0, 10) === sample.observedAt.slice(0, 10)) {
        if (last.pullCount === sample.pullCount) return history;
        samples.pop();
    }
    samples.push(sample);
    return validateHistory({ version: 1, repository, samples });
}

export async function run(directory) {
    const historyPath = join(directory, 'history.json');
    let history;
    try {
        history = JSON.parse(await readFile(historyPath, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        history = emptyHistory();
    }
    // Fetch and validate the count before modifying the history.
    const updated = await collect(history);
    await mkdir(directory, { recursive: true });
    await writeFile(historyPath, JSON.stringify(updated, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    run(resolve(process.argv[2] || 'dockerhub-pulls')).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
