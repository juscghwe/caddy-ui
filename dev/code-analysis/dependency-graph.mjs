import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'src/backend/src');
const output = path.resolve(process.argv[3] || 'dependencies.md');
const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return extensions.some(ext => entry.name.endsWith(ext)) ? [full] : [];
  });
}

function resolveImport(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [
    base,
    ...extensions.map(ext => base + ext),
    ...extensions.map(ext => path.join(base, 'index' + ext)),
  ];
  return candidates.find(candidate =>
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
}

const files = walk(root).sort();
const ids = new Map(files.map((file, i) => [file, `n${i}`]));
const edges = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');

  const patterns = [
    /\b(?:import|export)\s+(?:[^;]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = resolveImport(file, match[1]);
      if (target && ids.has(target)) {
        edges.add(`  ${ids.get(file)} --> ${ids.get(target)}`);
      }
    }
  }
}

const lines = ['flowchart LR'];

for (const [file, id] of ids) {
  const label = path.relative(root, file).replaceAll('\\', '/')
    .replaceAll('"', '#quot;');
  lines.push(`  ${id}["${label}"]`);
}

lines.push(...[...edges].sort());

fs.writeFileSync(
  output,
  '# Module dependencies\n\n```mermaid\n' +
  lines.join('\n') +
  '\n```\n'
);

console.log(`Generated ${output} (${files.length} modules, ${edges.size} edges)`);
