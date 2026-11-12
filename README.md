# Install DBSnapper Agent Action

[![GitHub Super-Linter](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/dbsnapper/install-dbsnapper-agent-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

## Overview

This action installs the [DBSnapper](https://dbsnapper.com) Agent on a runner as
part of a GitHub Actions workflow.

## Usage

The action takes an optional `version` input that specifies the version of the
Agent to install.

| `version`                    | What gets installed                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `latest` (default) or empty  | the newest published release that is **not a prerelease** (GitHub's "latest release") |
| `2.9.0` or `v2.9.0` (pinned) | exactly that release                                                                  |

Any other `version` fails the step.

```yaml
steps:
  - name: Install DBSnapper Agent
    uses: dbsnapper/install-dbsnapper-agent-action@v1
    with:
      version: latest
```

Supported: Linux runners (x64 and arm64) and DBSnapper Agent 2.7.1 or newer.
Other runners and older versions fail with
`Release … has no file … (HTTP 404 …)`.

### Token for `latest`

To resolve `latest`, the action asks the GitHub API for the newest release. It
sends the optional `token` input with that one request to `api.github.com` and
nowhere else; the default is the workflow's own token (`github.token`). Without
a token GitHub allows 60 such requests per hour per IP address. When GitHub
refuses the request (HTTP 403 or 429) the step fails with
`… most likely the GitHub rate limit`: pin a version, which needs no lookup.

### Checksum verification

Every DBSnapper release publishes a `checksums.txt` with the SHA-256 of each
file. Before it unpacks anything, the action downloads that file from the same
release and compares the archive's SHA-256 with its entry. The step fails, and
nothing is installed, when:

- the archive's SHA-256 differs from the published one
  (`Checksum mismatch for …`);
- the release has no `checksums.txt`, or it cannot be downloaded
  (`Cannot verify …`);
- `checksums.txt` has no entry for the archive (`… has no entry for …`).

The checksums file comes from the same GitHub release as the archive: it catches
a corrupted or swapped download, not a release whose files were all replaced
together.

## Sample DBSnapper job

Building on the above example, you can use a job similar to the following to run
a DBSnapper command such as this one that lists available targets:

```yaml
dbsnapper:
  runs-on: ubuntu-latest
  env:
    # Provide the minimum required DBSnapper environment variables
    # to run the DBSnapper agent in Cloud mode,
    # without a configuration file
    DBSNAPPER_SECRET_KEY: ${{ secrets.DBSNAPPER_SECRET_KEY }}
    DBSNAPPER_AUTHTOKEN: ${{ secrets.DBSNAPPER_AUTHTOKEN }}
  steps:
    - name: Install DBSnapper Agent
      uses: dbsnapper/install-dbsnapper-agent-action@v1
      with:
        version: latest
    - name: Run DBSnapper List Targets
      run: dbsnapper targets
```

More information on the DBSnapper Agent and its usage can be found in the
[DBSnapper documentation](https://docs.dbsnapper.com).
