import type { ScanResult, TokenStats } from "../types.js";

/**
 * Estimates token counts using a simple heuristic:
 * ~4 characters per token for English text/code (GPT/Claude average)
 * This avoids requiring tiktoken as a dependency.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculates token stats: how many tokens the output uses
 * vs. how many an AI would spend exploring the same info manually
 */
export function calculateTokenStats(
  result: ScanResult,
  outputContent: string,
  fileCount: number
): TokenStats {
  const outputTokens = estimateTokens(outputContent);

  // Estimate exploration cost:
  // - Each file read costs ~150 tokens (path + content snippet)
  // - Each route discovery requires reading the route file (~400 tokens avg)
  // - Each schema model requires reading the schema file (~300 tokens avg)
  // - Each component discovery requires reading the file (~250 tokens avg)
  // - Each grep/glob operation costs ~50 tokens for the command + results
  // - AI typically needs 3-5 exploration rounds to map a project

  const routeExplorationTokens = result.routes.length * 400;
  const schemaExplorationTokens = result.schemas.length * 300;
  const componentExplorationTokens = result.components.length * 250;
  const libExplorationTokens = result.libs.length * 200;
  const configExplorationTokens = result.config.envVars.length * 100;
  const middlewareExplorationTokens = result.middleware.length * 200;
  const graphExplorationTokens = result.graph.hotFiles.length * 150;

  // Add overhead for glob/grep operations to find files (typically 10-20 searches)
  const searchOverhead = Math.min(fileCount, 50) * 80;

  // Add overhead for multiple exploration rounds (AI often revisits files)
  const revisitMultiplier = 1.3;

  const estimatedExplorationTokens = Math.round(
    (routeExplorationTokens +
      schemaExplorationTokens +
      componentExplorationTokens +
      libExplorationTokens +
      configExplorationTokens +
      middlewareExplorationTokens +
      graphExplorationTokens +
      searchOverhead) *
      revisitMultiplier
  );

  return {
    outputTokens,
    estimatedExplorationTokens,
    saved: Math.max(0, estimatedExplorationTokens - outputTokens),
    fileCount,
  };
}
