import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeRepository } from './analyze.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.argv.includes('--help')) {
    console.log('Usage: npm run analysis:generate -- [output-directory]\nAnalyze both application services and write analysis.json.');
    process.exit(0);
}
if (process.argv.length > 3 || process.argv[2]?.startsWith('-')) throw new Error('Use npm run analysis:generate -- [output-directory]. The prototype source-directory/Markdown arguments are no longer supported.');
const output = path.resolve(root, process.argv[2] || 'dev/code-analysis/generated');
const snapshot = await analyzeRepository(root);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'analysis.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Analyzed ${snapshot.nodes.filter(node => node.kind === 'source').length} modules, ${snapshot.edges.length} references, ${snapshot.cycles.length} cyclic groups.`);
console.log(`${snapshot.diagnostics.length} diagnostics; snapshot: ${path.relative(root, output)}/analysis.json`);
