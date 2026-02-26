import path from "node:path";

export function resolveFindingPath(
  findingPath: string,
  workspaceRoot: string,
  repoRoot?: string,
): string {
  if (path.isAbsolute(findingPath)) {
    return findingPath;
  }

  if (repoRoot) {
    return path.resolve(repoRoot, findingPath);
  }

  return path.resolve(workspaceRoot, findingPath);
}
