# Threshold tuning (Phase 4)

Warden threshold defaults were tuned in IM04 to reduce noise from early runs.

## Defaults

- `staleDays`: `10` (was `6`)
- `highChurnEdits`: `5`
- `growthMultiplier`: `2`
- `directoryGrowthPct`: `20`
- `highRewriteRatio`: `3`
- `complexityHotspotCount`: `5`
- `largeFileGrowthLines`: `300`
- `lowRouteHitCount`: `2`
- `newFileClusterCount`: `6`

## Semantics

- `highRewriteRatio`: ratio used for `WD-M3-002` in 7d churn.
- `complexityHotspotCount`: per-file complexity findings threshold for `WD-M4-003`.
- `largeFileGrowthLines`: 7d growth threshold used by `WD-M6-004`.
- `lowRouteHitCount`: runtime route count threshold for `WD-M9-002`.
- `newFileClusterCount`: new files in a flagged directory for `WD-M1-003`.

## Per-repo override

Override values in `config/repos.json` under `thresholds`:

```json
{
  "slug": "example",
  "thresholds": {
    "staleDays": 14,
    "highRewriteRatio": 4,
    "lowRouteHitCount": 1
  }
}
```
