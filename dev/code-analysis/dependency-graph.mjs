import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeRepository } from './analyze.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(root, process.argv[2] || 'dev/code-analysis/generated');
const snapshot = await analyzeRepository(root);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'analysis.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Analyzed ${snapshot.nodes.filter(node => node.kind === 'source').length} modules, ${snapshot.edges.length} references, ${snapshot.cycles.length} cyclic groups.`);
console.log(`${snapshot.diagnostics.length} diagnostics; snapshot: ${path.relative(root, output)}/analysis.json`);
