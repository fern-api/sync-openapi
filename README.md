# Sync OpenAPI Action

A GitHub Action to sync OpenAPI specifications from your source repository to a target repository (like fern-config).

## Usage

1. Create a file named `sync-openapi.yml` in `.github/workflows/`. 
2. Include the following contents in the `sync-openapi.yml` you just created: 

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
        uses: sahil485/sync-openapi-test@main
        with:
          repository: fern-api/sync-openapi
          token: ${{ secrets.<PAT_TOKEN_NAME> }}
          files: |
            - source: path/to/first/source/file.yml
              destination: path/to/first/destination/file.yml
            - source: path/to/second/source/file.yml
              destination: path/to/second/destination/file.yml

                ....

          branch: main
          auto_merge: false

```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository` | Target repository in format `org/repo` | Yes | - |
| `files` | Array of mappings with source and destination paths | Yes | - |
| `token` | GitHub token for authentication | No | `${{ github.token }}` |
| `branch` | Branch to push to in the target repository | Yes | - |
| `auto_merge` | Will push directly to the specified branch when `true`, will create a PR from the specified base branch onto main if `false`. | No | `false` |


## Required Permissions

The GitHub token used for this action must have:

1. **Read access** to the source repository
2. **Read/Write access** to `Contents` and `Pull requests`

## Adding a Token for GitHub Actions

1. Generate a fine-grained https://github.com/settings/personal-access-tokens token with the above-mentioned permissions
2. Go to `Settings -> Secrets and variables -> Actions` and click on `New repository secret`
3. Name your token (i.e. `OPENAPI_SYNC_TOKEN`) and paste in the PAT token generated above
4. Replace `<PAT_TOKEN_NAME>` in the example YAML configuration with your token name.

