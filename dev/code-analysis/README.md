# Code relationship explorer

A local contributor tool for exploring the current application structure before
and during a refactor. It analyzes source without loading application modules.
Dependency-cruiser extracts and resolves dependencies; a Babel AST pass adds
source locations and Vite glob information. There is no application backend,
database, Docker dependency or authentication setup.

## Start

Use Node 22 LTS (22.18 or later) or Node 24 LTS (24.11 or later). From the repository
root, install dependencies if needed and start the explorer:

```sh
npm ci --prefix src/backend
npm ci --prefix src/frontend
npm ci --prefix dev
npm run analysis:preview
```

Open `http://127.0.0.1:5175`. The preview binds to loopback by default. For an
explicitly LAN-accessible or Dev Container preview, use
`npm run analysis:preview -- --host 0.0.0.0` and forward port 5175.

Frontend/backend dependencies are installed so their imports can be resolved;
their services are not started. Missing packages remain visible in diagnostics.
The generated CodeMirror Caddyfile mode is never fetched or required.

## Explore

- **Module:** search for a file and select it to see direct dependencies and
  importers. Follow an arrow's direction from importer to dependency. Dashed
  arrows represent dynamic imports or lazy globs. Reference tables show import
  kinds, file/line locations and source excerpts. The diagram limits each side
  to 24 neighbors; tables and exports retain all matching references.
- **Filters:** application and search filter the module list. Relationship kinds
  filter the neighborhood, reference tables, cycles and matrix. Packages,
  built-ins and assets are hidden initially; unresolved and generated modules
  remain visible. “Static” includes synchronous `require`; it does not mean the
  dependency necessarily executes at startup.
- **Cycles:** inspect strongly connected module groups. Switching to static-only
  relationships separates those from cycles involving lazy loading. Cycles are
  investigation leads, not automatically defects.
- **Folder matrix:** rows import columns. Counts are unique module pairs, not
  import statements, and include within-folder dependencies. Select a count to
  inspect the contributing references. Folder groups describe the current layout,
  not proposed architectural boundaries.
- **Compare:** upload a previously downloaded snapshot to compare full datasets.
  Added/removed relationships use importer, target, kind and specifier, ignoring
  source-line movement and repeated statements. Module additions/removals appear
  separately. Different analysis scopes are rejected; different tool versions
  produce a warning. Baseline files stay in the browser.
- **Diagnostics:** review unresolved dependencies, nonliteral imports, unsupported
  glob syntax and generated-module explanations. Unknown targets are not silently
  treated as absent dependencies.

Use **Export Mermaid** for a focused Markdown diagram of the selected module's
direct relationships, respecting the relationship/package filters. Use
**Download snapshot** to preserve the complete analysis for comparison or sharing.
The original checked-in `backend-deps.md` and `frontend-deps.md` prototypes are
replaced by these exports to avoid maintaining stale graph copies.

## Generate and compare reproducibly

```sh
# Write dev/code-analysis/generated/analysis.json without starting a server
npm run analysis:generate

# Optionally choose a different output directory, relative to the repository root
npm run analysis:generate -- /tmp/caddy-ui-analysis-before

# Build a static explorer, including the snapshot, in dev/code-analysis/dist
npm run analysis:build
```

Generate/download a baseline before a refactor, then regenerate and select that
baseline in Compare afterward. Regenerate after source changes; a browser refresh
alone does not reanalyze source. New files must be staged or committed to enter
the analysis scope. A tracked file missing from disk causes generation to fail
instead of quietly omitting it.

Snapshots contain a schema version, Git commit, tracked-application dirty flag,
source fingerprint, tool versions and scope. Node IDs are repository-relative
paths or explicit package/builtin/unresolved IDs, independent of enumeration
order. Output ordering is deterministic and there are no generation timestamps
or absolute checkout paths. Source excerpts are limited to 240 characters.
The fingerprint includes tracked scope paths and JavaScript contents. Generated
snapshots/builds are ignored by Git.

The version 1 dataset contains `metadata`, `nodes`, `edges`, `diagnostics`,
`cycles`, `staticCycles` and `matrix`. Each reference retains its kind, specifier,
source line/column and excerpt; repeated statements remain separate references.
Packages are grouped by import specifier, not installed version. Package internals
are not traversed.

## Scope and limits

The first milestone covers tracked `.js`, `.jsx`, `.mjs` and `.cjs` application
sources under `src/backend/src` and `src/frontend/src`. Tests, development tools,
TypeScript, CSS semantics and transitive package dependencies are outside this
scope. Referenced assets and files outside the source scope are represented but
not recursively analyzed. Generated `lib/caddyfileMode.js` is always an explicit
generated node, whether or not it exists in the checkout.

Vite `import.meta.glob` supports literal relative patterns, root-relative patterns
(relative to the owning service's project root), negative patterns and literal
`eager` options. Matches are limited to tracked application files. Aliases,
computed patterns/options and options other than literal `eager` (including
custom `base`) are reported as unsupported.
Syntax errors stop generation; an old snapshot must not be interpreted as a
successful fresh analysis.

This is a module graph, not a runtime call graph, test-coverage map, security
audit or proof that a file is unused. Computed imports, custom loaders, aliases,
shadowed CommonJS `require` and runtime selection can limit static analysis.
The AST pass adds evidence; dependency-cruiser remains responsible for resolving
ordinary imports. Nothing enforces a proposed architecture or modifies source.

Frontend-to-backend API tracing, persistence/external-operation relationships and
test relationships are follow-ups. They need their own relationship types and
evidence; importing an API wrapper is not sufficient to infer an endpoint call.

## Checks

```sh
npm run test:dev-caddy
npm run lint:dev-caddy
npm run analysis:build
npm exec --prefix dev -- playwright install chromium
npm run analysis:check-browser
```

Analysis regression tests are included in the existing development test command.
The browser check runs independently of Docker/Caddy and is also included in CI.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium executable;
optionally set `ANALYSIS_SCREENSHOT` to save a browser screenshot.
