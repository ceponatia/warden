import { TrajectoryStore } from "./trajectory-store.js";
import { generateProjectStateLens, generateLocalImpactLens, generateTrajectorySummary } from "./trajectory-lenses.js";
import { exportMermaidTrajectory } from "./trajectory-vizvibe.js";
import { renderTrajectoryComment } from "./trajectory-comment-renderer.js";
import { upsertTrajectoryComment } from "../github/comment.js";
import { fetchPrDetails, fetchPrDiff } from "../github/pr.js";

export async function postTrajectoryCommentOnPr(
  owner: string,
  repo: string,
  prNumber: number,
  repoSlug: string,
  options: {
    includeLocalImpact: boolean;
  },
): Promise<void> {
  const store = new TrajectoryStore(repoSlug);
  const graph = await store.load();

  // 1. Generate Project State lens (always)
  const projectState = generateProjectStateLens(graph);
  const projectStateMmd = exportMermaidTrajectory(projectState);

  // 2. Generate Local Impact lens (on merge only)
  let localImpactMmd: string | undefined;
  if (options.includeLocalImpact) {
    try {
      const [prDetails, prDiff] = await Promise.all([
        fetchPrDetails(owner, repo, prNumber),
        fetchPrDiff(owner, repo, prNumber),
      ]);
      const localImpact = await generateLocalImpactLens(
        graph, prDiff, prDetails.title, prDetails.body ?? "",
      );
      if (localImpact) {
        localImpactMmd = exportMermaidTrajectory(localImpact);
      }
    } catch (error) {
      console.error("Failed to generate Local Impact lens:", error);
    }
  }

  // 3. Generate AI summary (best-effort)
  const summary = await generateTrajectorySummary(graph, projectState);

  // 4. Render comment body
  const body = renderTrajectoryComment({
    projectState: projectStateMmd,
    localImpact: localImpactMmd,
    summary: summary || undefined,
    prNumber,
    repoSlug,
  });

  // 5. Post/update comment
  await upsertTrajectoryComment(owner, repo, prNumber, body);
}
