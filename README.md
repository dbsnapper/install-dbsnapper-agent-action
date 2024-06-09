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
Agent to install. If no version is specified, the latest version is installed.

```yaml
steps:
  - name: Install DBSnapper Agent
    uses: dbsnapper/install-dbsnapper-agent-action@v1
    with:
      version: latest
```

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
