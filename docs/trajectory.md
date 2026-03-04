# Working with Trajectory

Track project work as a graph linked to Warden findings.

## Initialize Trajectory

Create a new trajectory graph for a repo:

```bash
pnpm warden trajectory init --repo my-project
```

This creates `data/my-project/trajectory/state.json` with an empty graph.

## Import from vizvibe.mmd

If you have an existing Mermaid trajectory file:

```bash
pnpm warden trajectory import --repo my-project --from ./vizvibe.mmd
```

The importer parses `%% @node-id [type, status]: description` annotations and converts them to structured nodes.

## View Current State

```bash
pnpm warden trajectory get --repo my-project
```

Outputs a table of all nodes with their status and last update.

## Export to Mermaid

Generate a Mermaid flowchart from the canonical graph:

```bash
pnpm warden trajectory export --repo my-project --to ./vizvibe.mmd
```

## Update via Patch

Create a JSON file with patch operations:

```json
[
  {
    "type": "addNode",
    "node": {
      "id": "fix-auth-bug",
      "title": "Fix authentication bypass",
      "status": "opened",
      "type": "task",
      "findingRefs": ["WD-M6-001"],
      "workRefs": [],
      "tags": ["security", "urgent"],
      "metadata": {}
    }
  },
  {
    "type": "addEdge",
    "edge": {
      "from": "fix-auth-bug",
      "to": "release-v2",
      "kind": "blocks",
      "metadata": {}
    }
  }
]
```

Apply it:

```bash
pnpm warden trajectory patch --repo my-project --ops changes.json
```

## Link to Findings

When a trajectory node addresses a Warden finding, link them:

```json
{
  "type": "addNode",
  "node": {
    "id": "reduce-complexity",
    "title": "Refactor complex module",
    "status": "opened",
    "type": "task",
    "findingRefs": ["WD-M4-001"],
    ...
  }
}
```

View the finding code with `pnpm warden wiki WD-M4-001` to understand the issue.

## Validate Graph

Check for errors (cycles, dangling edges, invalid references):

```bash
pnpm warden trajectory validate --repo my-project
```

## CI Integration

Automatically sync trajectory on PR merge via GitHub Actions:

```yaml
name: Trajectory Sync
on:
  pull_request:
    types: [closed]
jobs:
  sync:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm warden trajectory sync-pr --repo my-project --pr ${{ github.event.pull_request.number }} --owner ${{ github.repository_owner }} --repo-name ${{ github.event.repository.name }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Dashboard View

Start the dashboard to visualize trajectory:

```bash
pnpm warden dashboard --port 3333
```

Navigate to `http://localhost:3333/repo/my-project/trajectory`

## Common Workflows

### Mark work as complete

```json
[
  {
    "type": "updateNode",
    "id": "fix-auth-bug",
    "updates": { "status": "closed" }
  }
]
```

### Block a task pending another

```json
[
  {
    "type": "updateNode",
    "id": "release-v2",
    "updates": { "status": "blocked" }
  },
  {
    "type": "addEdge",
    "edge": {
      "from": "fix-auth-bug",
      "to": "release-v2",
      "kind": "blocks"
    }
  }
]
```

### Remove completed work from view

Delete a node (and its connected edges):

```json
[
  {
    "type": "deleteNode",
    "id": "old-spike-task"
  }
]
```

## Data Retention

Trajectory state persists in `data/<slug>/trajectory/state.json`. Include this in your backup strategy. The file is human-readable JSON and can be version controlled if desired.

## Troubleshooting

**"Graph contains cycles" error:**
- Check that you haven't created circular dependencies with `blocks` edges
- Use `relatesTo` instead of `blocks` for non-blocking relationships

**"Node not found" error:**
- Verify node IDs in your patch file match existing nodes
- Use `warden trajectory get` to list valid IDs

**Import warnings:**
- The Mermaid importer reports unmapped lines to stderr
- Check that your `%% @annotations` follow the expected format
