# Historical documentation collection

This is the collection stage of [#288](https://github.com/zackwag/caddy-ui/issues/288).
It inventories historical releases, builds their books, and reports books that can
share a snapshot. Pages publication, the version selector and UI Help links follow
separately. The existing documentation deployment is unchanged.

The [initial collection report](collection-report.md) covers v2.20.0–v3.6.0:
44 candidates, 43 complete books and 40 byte-distinct snapshots. v3.0.0 is flagged
because its legacy screenshot fixture reports an unauthenticated installation;
the renderer skips failed readiness checks and captures the wrong view. Its source
and build log remain available for a reviewed repair or release-notes fallback.

## Release and image evidence

The first mdBook implementation is `4dee6c9`; its first release is **v2.20.0**
(`aeb981f`). `releases.json` records stable release tags and their resolved source
commits, along with separate frontend/backend publication records. Each image
entry points to the earliest `versions`-branch commit retaining that version.
An absent component publication is `null`, never inferred from the release tag.

Docker image versions inherit release numbers when that component builds.
Components can skip releases independently. Mutable `latest`, major/minor, edge
and beta tags are not historical stable-version identities. The current update
feed keeps only 20 entries per component/channel; inventory scans the complete
history instead. Publication records are evidence of a reported successful push,
not a check that an image is still available in Docker Hub today.

Refresh the local upstream refs and inventory from the repository root:

```sh
git fetch https://github.com/zackwag/caddy-ui.git --tags refs/heads/main:refs/remotes/upstream/main refs/heads/versions:refs/remotes/upstream/versions
npm run docs:history:inventory -- --from v2.20.0 --to refs/remotes/upstream/main
```

The command uses stable tags reachable from the selected source boundary.
Review and commit inventory updates separately from tooling changes. Releases
before v2.20.0 need a release-notes fallback in the future online resolver.

## Build the historical books

Use Node 22.12 or newer, npm, Git and mdBook **0.5.4**. Install this checkout's
documentation tooling with `npm ci --prefix docs --ignore-scripts`. Later releases
also need a Playwright browser; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a
compatible system Chromium, as with the existing screenshot command.

```sh
npm run docs:history:backfill
# Or select a binary and a subset of releases, including retries:
npm run docs:history:backfill -- --mdbook /path/to/mdbook --releases v2.20.0,v3.6.0
```

Each release gets a detached temporary worktree. The builder installs its locked
documentation dependencies and, when necessary, its frontend/development
dependencies using `npm ci --ignore-scripts`. It runs that release's screenshot
renderer and coverage generator before building its book. Earlier releases use
their committed screenshots. No current-book text or assets are substituted.
The current dev checkout and its running services are not switched or stopped.

These are **backfilled renders**, not copies of the original deployed Pages
artifacts. Generated screenshots reflect the release's renderer/capture and the
browser used today. Historical frontend prebuilds can fetch the Caddyfile syntax
asset; its resulting SHA-256 is recorded. Lockfiles, source commits and tool
versions provide provenance, but external inputs can prevent identical rerenders.
Run historical scripts only for trusted release sources and retain the results.

Output defaults to ignored `.docs-history/`:

- `backfill.json`: release inventory, individual build results and provenance.
- `books/<sha256>/`: complete rendered snapshots, with exact duplicates stored once.
- `logs/<tag>.log`: dependency, renderer and mdBook output for each attempt.
- `groups.json`: every release's selected snapshot and grouping reason.
- `report.md`: build status, component image mappings and duplicate summary.

The builder checks local HTML media/styles/scripts and search-index presence.
Failures remain explicit, other releases continue, and the command exits with a
failure status. Completed results are checkpointed after each release. A subset
retry preserves other results for the same inventory. Changing the inventory
requires a separate `--output` directory. Worktrees are removed on success,
failure and handled cancellation; the output archive is retained.

## Share books deliberately

Exact grouping hashes **every output path and byte**, including media and search.
Publication labels and URLs are not injected at this stage; books use the same
neutral `/` site URL. Wording, whitespace and generated repository-tree changes
all count. Identical authored Markdown alone does not prove identical books.

For a wording-only difference, first compare both successful builds, for example:

```sh
diff -ru .docs-history/books/FIRST_SHA256 .docs-history/books/SECOND_SHA256
git diff FIRST_RELEASE SECOND_RELEASE -- README.md docs
```

Then record a reviewed decision in `groups.json` **in this directory**, using
real inventory tags. This example illustrates the schema, not an approved alias:

```json
{
    "schema": 1,
    "aliases": {
        "v2.20.1": {
            "target": "v2.20.0",
            "reason": "Describe the reviewed differences and why this book remains accurate."
        }
    }
}
```

Regenerate the report without rebuilding:

```sh
npm run docs:history:report
```

Both books must have built successfully; unknown targets, cycles, empty reasons
and altered/missing snapshot bytes are rejected. The original fingerprints and
books remain in the archive. Grouping changes only the selected snapshot, while
each release and component-image mapping retains its provenance. Commit the
grouping decision with its review reason. No wording-based grouping is automatic.

Run `npm test --prefix docs` for inventory, grouping, integrity, failure/retry and
existing documentation-tooling regressions. Keep the generated archive outside
Git; archive it with its manifests and logs before discarding the local output.
