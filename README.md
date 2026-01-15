# sync-openapi

A GitHub Action to [sync OpenAPI specifications with your Fern setup](/learn/api-definitions/openapi/sync-your-open-api-specification). Choose your scenario:

- **Case 1: Sync from public URL (most common).** Your OpenAPI spec is hosted at a publicly available URL and you want to pull it into your fern folder. The GitHub Action uses `fern api update` to pull the latest version of your OpenAPI spec from the `origin` field in your `generators.yml` file. 
- **Case 2: Sync between repositories**: Your OpenAPI spec lives in one repository and you want to sync it to another repository where your fern folder lives (like fern-config). The GitHub Action uses explicit file mappings to pull the latest version of your OpenAPI spec. 

## Usage

### Case 1: Sync specs from public URL (recommended)

1. In your source repo, create a file named `sync-openapi.yml` in `.github/workflows/`. 
2. Include the following contents in `sync-openapi.yml`: 

```yaml
name: Sync OpenAPI Specs # can be customized
on:                                              # additional custom triggers can be configured, examples below
  workflow_dispatch:                             # manual dispatch
  push:                                          
    branches:
      - main                                     # on push to main
  schedule:
    - cron: '0 3 * * *'                          # everyday at 3:00 AM UTC

jobs:
  update-from-source:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.OPENAPI_SYNC_TOKEN }}
      - name: Update API with Fern
        uses: fern-api/sync-openapi@v2
        with:
          update_from_source: true
          token: ${{ secrets.OPENAPI_SYNC_TOKEN }}
          branch: 'update-api'
          auto_merge: false                        # you MUST use auto_merge: true with branch: main

```

### Case 2: Sync files/folders between repositories

1. In your source repo, create a file named `sync-openapi.yml` in `.github/workflows/`. 
2. Include the following contents in `sync-openapi.yml`: 

```yaml
name: Sync OpenAPI Specs # can be customized
on:                                              # additional custom triggers can be configured, examples below
  workflow_dispatch:                             # manual dispatch
  push:                                          
    branches:
      - main                                     # on push to main
  schedule:
    - cron: '0 3 * * *'                          # everyday at 3:00 AM UTC

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Sync OpenAPI spec to target repo
        uses: fern-api/sync-openapi@v2
        with:
          repository: <your-org>/<your-target-repo>
          token: ${{ secrets.<PAT_TOKEN_NAME> }}
          sources:                                # all paths are relative to source repository root
            - from: path/to/source/dir            # supports folder syncing
              to: path/to/target/dir    
              exclude:                            # optional
                - "path/to/file/to/exclude.yaml"  # supports individual file exclusion
                - "path/to/dir/to/exclude/**"     # supports glob-based pattern matching
                - "path/to/files/*_test.yaml"
            - from: path/to/source/file.yaml      # supports individual file syncing
              to: path/to/target/file.yaml    
                ....

          branch: main
          auto_merge: true                        # you MUST use auto_merge: true with branch: main

```
## Inputs

| Input               | Description                                                                                                                                 | Required | Default                  | Case    |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------|----------|---------------------------|---------|
| `token`             | GitHub token for authentication                                                                                                            | No       | `${{ github.token }}`     | 1, 2   |
| `branch`            | Branch to push to in the target repository                                                                                                 | Yes      | -                         | 1, 2   |
| `auto_merge`        | If `true`, pushes directly to the branch; if `false`, creates a PR from the branch onto `main`                                            | No       | `false`                   | 1, 2   |
| `sources`           | Array of mappings with `from`, `to`, and optional `exclude` fields                                                                         | Yes      | -                         | 2   |
| `repository`        | Target repository in format `org/repo`                                                                                                     | Yes      | -                         | 2   |
| `update_from_source`| If `true`, syncs from the source spec files rather than using existing intermediate formats                                               | No       | `false`                   | 1   |


**Note: you must set `auto_merge: true` when using `branch: main`**

## Required Permissions

The GitHub token used for this action must have:

1. **Read access** to the source repository
2. **Read/Write access** to `Contents` and `Pull requests` for the repository being updated

## Adding a Token for GitHub Actions

1. Generate a fine-grained https://github.com/settings/personal-access-tokens token with the above-mentioned permissions
2. Go to `Settings -> Secrets and variables -> Actions` and click on `New repository secret`
3. Name your token (i.e. `OPENAPI_SYNC_TOKEN`) and paste in the PAT token generated above
4. Replace `<PAT_TOKEN_NAME>` in the example YAML configuration with your token name.

