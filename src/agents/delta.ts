import type { SnapshotBundle } from "../types/snapshot.js";

export interface SnapshotDelta {
  staleFilesDelta: number;
  staleDirectoriesDelta: number;
  totalTodosDelta: number;
  totalFixmesDelta: number;
  totalHacksDelta: number;
  totalEslintDisablesDelta: number;
  totalAnyCastsDelta: number;
  complexityFindingsDelta: number | null;
  deepImportsDelta: number | null;
  circularChainsDelta: number | null;
}

export function computeDelta(
  previous: SnapshotBundle,
  current: SnapshotBundle,
): SnapshotDelta {
  const complexityFindingsDelta =
    current.complexity != null && previous.complexity != null
      ? current.complexity.summary.totalFindings -
        previous.complexity.summary.totalFindings
      : null;

  const deepImportsDelta =
    current.imports != null && previous.imports != null
      ? current.imports.summary.deepImports -
        previous.imports.summary.deepImports
      : null;

  const circularChainsDelta =
    current.imports != null && previous.imports != null
      ? current.imports.summary.circularChains -
        previous.imports.summary.circularChains
      : null;

  return {
    staleFilesDelta:
      current.staleness.staleFiles.length -
      previous.staleness.staleFiles.length,
    staleDirectoriesDelta:
      current.staleness.staleDirectories.length -
      previous.staleness.staleDirectories.length,
    totalTodosDelta:
      current.debtMarkers.summary.totalTodos -
      previous.debtMarkers.summary.totalTodos,
    totalFixmesDelta:
      current.debtMarkers.summary.totalFixmes -
      previous.debtMarkers.summary.totalFixmes,
    totalHacksDelta:
      current.debtMarkers.summary.totalHacks -
      previous.debtMarkers.summary.totalHacks,
    totalEslintDisablesDelta:
      current.debtMarkers.summary.totalEslintDisables -
      previous.debtMarkers.summary.totalEslintDisables,
    totalAnyCastsDelta:
      current.debtMarkers.summary.totalAnyCasts -
      previous.debtMarkers.summary.totalAnyCasts,
    complexityFindingsDelta,
    deepImportsDelta,
    circularChainsDelta,
  };
}
