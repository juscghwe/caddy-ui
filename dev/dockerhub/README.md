# Docker Hub pull history

This worker records the public integer `pull_count` for `zackwag/caddy-ui-backend`. It needs no Docker Hub credentials, extra npm
dependencies, application containers or browser.

The repository README shows a small Shields badge for this backend count.
Historical collection stays separate: this change does not add a history graph
to the README, Docker Hub descriptions or mdBook.

## Pull-count badge

Shields' native Docker pull badge works independently of this worker:

```markdown
[![Docker pulls](https://img.shields.io/docker/pulls/zackwag/caddy-ui-backend?style=flat-square)](https://hub.docker.com/r/zackwag/caddy-ui-backend)
```

The badge may abbreviate large values and is cached by Shields. The stored
history retains the integer API values. An exact-count badge can be added later
with Shields' JSON endpoint support if needed; no such endpoint is required now.

## Daily collection and storage

`.github/workflows/dockerhub-pulls.yml` runs daily at **00:17 UTC** on the upstream
repository. It also supports **Run workflow** manually, including in forks.
Scheduled workflows use the default branch; this schedule becomes active after
the workflow lands there. GitHub can delay or skip scheduled runs, and disables
scheduled workflows in inactive public repositories after 60 days. This is a
best-effort daily observation, not an exact-midnight monitoring service.

The workflow creates an orphan `dockerhub-pull-history` branch on its first
successful run and keeps `history.json` there: timestamped cumulative counts,
with one observation per UTC day.

The data branch is the durable source; the workflow artifact is a convenient
30-day download. The branch contains no application code or workflows. Updates
use the Actions token with `contents: write`, without stored personal credentials
or force pushes. They do not modify `main`, open PRs, build images or create releases.
Conflicting branch updates fail instead of overwriting someone else's history.

## Local use

Use the Node version from `.node-version`:

```bash
node dev/dockerhub/collect.mjs /tmp/caddy-ui-dockerhub-pulls
```

An existing `history.json` in that output directory is extended; otherwise history
starts with the first successful observation. To continue the published dataset
locally, copy its `history.json` from the data branch first. Files generated in a
temporary directory do not need to be committed to the application branch.

The API must return a valid count before history changes. A failed HTTP
request, unreadable JSON or invalid count fails the run; it never substitutes zero.
A missing/corrupt history file on an existing data branch also fails rather than
resetting history. Rerunning on the same UTC day replaces that day's observation
if counts changed; identical same-day results do not create another data commit.

## Interpreting the counts

These are observed cumulative repository pulls, **not unique users or installs**.
CI, automated updaters and repeated downloads contribute. Docker Hub may update
the counter with a delay or correct it downwards; the worker retains observed values.

There is no historical backfill: missing days remain missing, and samples
retain their actual observation timestamps. A difference between two observations
spans that interval; it is not necessarily a 24-hour download total.

Graph rendering can be added once there is enough history to make it useful.
No Pages deployment or public application endpoint is required for collection.

## Checks

```bash
npm run test:workflows
npm run lint:dev-caddy
```

The workflow suite covers collection failures, same-day retries, corrupt history,
data-branch initialization and conflicting publication, using simulated Docker
Hub and GitHub responses. A manual workflow run verifies live API access and the
repository's permission to write the data branch.
