import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyHistory, validateHistory } from './collect.mjs';

export const dataBranch = 'dockerhub-pull-history';

// Called by actions/github-script. Only a missing branch permits initialization;
// a missing/corrupt history file on an existing branch must not reset the data.
export async function restore({ github, context, directory }) {
    const repo = context.repo;
    let head;
    try {
        const result = await github.rest.git.getRef({ ...repo, ref: `heads/${dataBranch}` });
        head = result.data.object.sha;
    } catch (error) {
        if (error.status !== 404) throw error;
    }
    let history = emptyHistory();
    if (head) {
        const { data } = await github.rest.repos.getContent({ ...repo, ref: head, path: 'history.json' });
        if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Cannot read stored pull history');
        history = validateHistory(JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')));
    }
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'history.json'), JSON.stringify(history, null, 2) + '\n');
    return head || '';
}

export async function publish({ github, context, directory, head }) {
    const repo = context.repo;
    const tree = await Promise.all(['history.json'].map(async path => ({
        path, mode: '100644', type: 'blob', content: await readFile(join(directory, path), 'utf8'),
    })));
    let baseTree;
    if (head) {
        const previous = await github.rest.git.getCommit({ ...repo, commit_sha: head });
        baseTree = previous.data.tree.sha;
    }
    const createdTree = await github.rest.git.createTree({ ...repo, ...(baseTree ? { base_tree: baseTree } : {}), tree });
    if (createdTree.data.sha === baseTree) return;
    const commit = await github.rest.git.createCommit({
        ...repo, message: 'chore(stats): record Docker Hub pull counts', tree: createdTree.data.sha,
        parents: head ? [head] : [],
    });
    if (head) {
        // A conflicting writer must fail rather than overwrite newer history.
        await github.rest.git.updateRef({ ...repo, ref: `heads/${dataBranch}`, sha: commit.data.sha, force: false });
    } else {
        await github.rest.git.createRef({ ...repo, ref: `refs/heads/${dataBranch}`, sha: commit.data.sha });
    }
}
