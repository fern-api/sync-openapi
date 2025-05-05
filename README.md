# sync-openapi

A GitHub Action to sync files/folders from your source repository to a target repository (like fern-config).

## Usage

1. In your your source repo, create a file named `sync-openapi.yml` in `.github/workflows/`. 
2. Include the following contents in `sync-openapi.yml`: 

```yaml
name: Sync OpenAPI Specs # can be customized
on:
  workflow_dispatch:
  push:
    branches:
      - main
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Sync OpenAPI spec to target repo
        uses: fern-api/sync-openapi@v0
        with:
          repository: <your-org>/<your-target-repo>
          token: ${{ secrets.<PAT_TOKEN_NAME> }}
          sources:                                # all paths are relative to source repository root
            - from: path/to/source/dir            # supports folder syncing
              to: path/to/target/dir    
              exclude:                            # optional
                - path/to/file/to/exclude.yaml    # supports individual file exclusion
                - path/to/dir/to/exclude/**       # supports glob-based pattern matching
                - path/to/files/*_test.yaml
            - from: path/to/source/file.yaml      # supports individual file syncing
              to: path/to/target/file.yaml    
                ....

          branch: main
          auto_merge: true                        # you MUST use auto_merge: true with branch: main

```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository` | Target repository in format `org/repo` | Yes | - |
| `sources` | Array of mappings with from, to, and (optional) exclude fields | Yes | - |
| `token` | GitHub token for authentication | No | `${{ github.token }}` |
| `branch` | Branch to push to in the target repository | Yes | - |
| `auto_merge` | Will push directly to the specified branch when `true`, will create a PR from the specified base branch onto main if `false`. | No | `false` |

**Note: you must set `auto_merge: true` when using `branch: main`**

## Required Permissions

The GitHub token used for this action must have:

1. **Read access** to the source repository
2. **Read/Write access** to `Contents` and `Pull requests` for the target repository

## Adding a Token for GitHub Actions

1. Generate a fine-grained https://github.com/settings/personal-access-tokens token with the above-mentioned permissions
2. Go to `Settings -> Secrets and variables -> Actions` and click on `New repository secret`
3. Name your token (i.e. `OPENAPI_SYNC_TOKEN`) and paste in the PAT token generated above
4. Replace `<PAT_TOKEN_NAME>` in the example YAML configuration with your token name.

