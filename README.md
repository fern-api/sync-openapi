# Sync OpenAPI Action

A GitHub Action to sync OpenAPI specifications from your source repository to a target repository (like fern-config).

## Usage

```yaml
name: Sync OpenAPI Specs

on:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Sync OpenAPI spec to fern-config
        uses: your-org/sync-openapi@v1
        with:
          repository: 'your-org/fern-config'
          token: ${{ secrets.PAT_TOKEN }}  # Personal access token with repo scope
          openapi: |
            - source: server1/openapi.yml
              destination: fern/apis/server1/openapi/my-openapi.yml
            - source: server2/openapi.yml
              destination: fern/apis/server2/openapi/my-openapi.yml
          auto_merge: 'true'  # Optional
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository` | Target repository in format org/repo | Yes | - |
| `openapi` | YAML array of OpenAPI mappings with source and destination paths | Yes | - |
| `token` | GitHub token for authentication | No | `${{ github.token }}` |
| `branch` | Branch name to create in the target repository | No | `update-openapi` |
| `auto_merge` | Whether to automatically merge the PR | No | `false` |


## Required Permissions

The GitHub token used for this action must have:

1. **Read access** to the source repository (where the action is running)
2. **Write access** to the target repository (where the PR will be created)

## How it works

1. Clones the target repository
2. Copies the specified OpenAPI files from the source repository to the target repository
3. Creates a pull request with the changes
4. Optionally auto-merges the pull request

