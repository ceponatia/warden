import { TrajectoryStore } from "./trajectory-store.js";
import { generateProjectStateLens, generateLocalImpactLens } from "./trajectory-lenses.js";
import { renderTrajectoryComment } from "./trajectory-comment-renderer.js";
import { upsertTrajectoryComment } from "../github/comment.js";
import { fetchPrDetails, fetchPrDiff } from "../github/pr.js";

import { resolveProviderConfig } from "../agents/provider.js";

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
  
  const providerConfig = resolveProviderConfig();

  // 1. Generate Project State lens (always)
  const projectStateMmd = await generateProjectStateLens(graph);

  // 2. Generate Local Impact lens (on merge only)
  let localImpactMmd: string | undefined;
  if (options.includeLocalImpact) {
    try {
      const [prDetails, prDiff] = await Promise.all([
        fetchPrDetails(owner, repo, prNumber),
        fetchPrDiff(owner, repo, prNumber),
      ]);
      localImpactMmd = await generateLocalImpactLens(
        graph, prDiff, prDetails.title, prDetails.body ?? "",
      );
    } catch (error) {
      console.error("Failed to generate Local Impact lens:", error);
    }
  }

  // 3. Render comment body
  const body = renderTrajectoryComment({
    projectState: projectStateMmd,
    localImpact: localImpactMmd,
    prNumber,
    repoSlug,
    aiModel: providerConfig.model,
  });

  // 4. Post/update comment
  await upsertTrajectoryComment(owner, repo, prNumber, body);
}
