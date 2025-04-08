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

## Required Permissions

To use this action successfully, you need:

1. **For the default `github.token`**: If both repositories are in the same organization and the workflow has been granted permission to access other repositories, this may work. However, the default token typically has limited cross-repository access.

2. **Personal Access Token (recommended)**: Create a PAT with:
   - `repo` scope (for private repositories)
   - Store it as a repository secret (e.g., `PAT_TOKEN`)
   - The user who created the PAT must have write access to the target repository

3. **GitHub App**: For organizational use, consider creating a GitHub App with:
   - Repository permissions: `Contents: write`, `Pull requests: write`
   - Install the app on all relevant repositories

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository` | Target repository in format org/repo | Yes | - |
| `openapi` | YAML array of OpenAPI mappings with source and destination paths | Yes | - |
| `token` | GitHub token for authentication | No | `${{ github.token }}` |
| `branch` | Branch name to create in the target repository | No | `update-openapi` |
| `auto_merge` | Whether to automatically merge the PR | No | `false` |

## How it works

1. Clones the target repository
2. Copies the specified OpenAPI files from the source repository to the target repository
3. Creates a pull request with the changes
4. Optionally auto-merges the pull request

## Required Permissions

The GitHub token used for this action must have:

1. **Read access** to the source repository (where the action is running)
2. **Write access** to the target repository (where the PR will be created)
