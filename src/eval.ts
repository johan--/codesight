/**
 * Evaluation suite: runs codesight on fixture repos and measures
 * precision, recall, and F1 against ground truth.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, detectProject } from "./scanner.js";
import { detectRoutes } from "./detectors/routes.js";
import { detectSchemas } from "./detectors/schema.js";
import { detectComponents } from "./detectors/components.js";
import { detectConfig } from "./detectors/config.js";
import { detectMiddleware } from "./detectors/middleware.js";

interface GroundTruth {
  routes?: { method: string; path: string }[];
  models?: { name: string; fields?: string[]; relations?: string[] }[];
  components?: { name: string; props?: string[] }[];
  envVars?: string[];
  middleware?: string[];
}

interface EvalMetrics {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

interface FixtureResult {
  name: string;
  routes: EvalMetrics;
  models: EvalMetrics;
  components?: EvalMetrics;
  envVars: EvalMetrics;
  middleware?: EvalMetrics;
  runtime: number;
}

function calcMetrics(detected: Set<string>, expected: Set<string>): EvalMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const item of detected) {
    if (expected.has(item)) tp++;
    else fp++;
  }
  for (const item of expected) {
    if (!detected.has(item)) fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
  };
}

async function createTempRepo(fixture: any): Promise<string> {
  const tmpDir = join(
    (await import("node:os")).tmpdir(),
    `codesight-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  for (const [filePath, content] of Object.entries(fixture.files)) {
    const fullPath = join(tmpDir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content as string);
  }

  return tmpDir;
}

async function evalFixture(fixturePath: string): Promise<FixtureResult> {
  const repoJson = JSON.parse(await readFile(join(fixturePath, "repo.json"), "utf-8"));
  const groundTruth: GroundTruth = JSON.parse(
    await readFile(join(fixturePath, "ground-truth.json"), "utf-8")
  );

  // Create temp repo from fixture
  const tmpDir = await createTempRepo(repoJson);

  const startTime = Date.now();

  try {
    // Run codesight detectors
    const project = await detectProject(tmpDir);
    const files = await collectFiles(tmpDir, 10);
    const [routes, schemas, components, config, middleware] = await Promise.all([
      detectRoutes(files, project),
      detectSchemas(files, project),
      detectComponents(files, project),
      detectConfig(files, project),
      detectMiddleware(files, project),
    ]);

    const runtime = Date.now() - startTime;

    // Compare routes: method:path
    const detectedRoutes = new Set(routes.map((r) => `${r.method}:${r.path}`));
    const expectedRoutes = new Set((groundTruth.routes || []).map((r) => `${r.method}:${r.path}`));

    // Compare models: name
    const detectedModels = new Set(schemas.map((s) => s.name.toLowerCase()));
    const expectedModels = new Set((groundTruth.models || []).map((m) => m.name.toLowerCase()));

    // Compare env vars
    const detectedEnvVars = new Set(config.envVars.map((e) => e.name));
    const expectedEnvVars = new Set(groundTruth.envVars || []);

    const result: FixtureResult = {
      name: repoJson.name,
      routes: calcMetrics(detectedRoutes, expectedRoutes),
      models: calcMetrics(detectedModels, expectedModels),
      envVars: calcMetrics(detectedEnvVars, expectedEnvVars),
      runtime,
    };

    // Components (if ground truth has them)
    if (groundTruth.components && groundTruth.components.length > 0) {
      const detectedComps = new Set(components.map((c) => c.name));
      const expectedComps = new Set(groundTruth.components.map((c) => c.name));
      result.components = calcMetrics(detectedComps, expectedComps);
    }

    // Middleware
    if (groundTruth.middleware && groundTruth.middleware.length > 0) {
      const detectedMw = new Set(middleware.map((m) => m.name));
      const expectedMw = new Set(groundTruth.middleware);
      result.middleware = calcMetrics(detectedMw, expectedMw);
    }

    return result;
  } finally {
    // Cleanup temp dir
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printMetrics(label: string, m: EvalMetrics): void {
  console.log(
    `    ${label.padEnd(14)} P: ${formatPercent(m.precision).padStart(6)}  R: ${formatPercent(m.recall).padStart(6)}  F1: ${formatPercent(m.f1).padStart(6)}  (TP:${m.truePositives} FP:${m.falsePositives} FN:${m.falseNegatives})`
  );
}

export async function runEval(): Promise<void> {
  // Find eval fixtures
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const evalDir = join(__dirname, "..", "eval", "fixtures");

  let fixtureNames: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    fixtureNames = await readdir(evalDir);
  } catch {
    // Try from dist path
    const altDir = join(__dirname, "..", "..", "eval", "fixtures");
    const { readdir } = await import("node:fs/promises");
    fixtureNames = await readdir(altDir);
    // Override evalDir for the loop below
    return runEvalFromDir(altDir, fixtureNames);
  }

  return runEvalFromDir(evalDir, fixtureNames);
}

async function runEvalFromDir(evalDir: string, fixtureNames: string[]): Promise<void> {
  console.log(`\n  codesight eval — precision/recall benchmarks\n`);

  const results: FixtureResult[] = [];
  let totalPrecision = 0;
  let totalRecall = 0;
  let totalF1 = 0;
  let metricCount = 0;

  for (const name of fixtureNames) {
    const fixturePath = join(evalDir, name);

    // Check if it has repo.json
    try {
      await import("node:fs/promises").then((fs) => fs.stat(join(fixturePath, "repo.json")));
    } catch {
      continue;
    }

    process.stdout.write(`  ${name}...`);
    const result = await evalFixture(fixturePath);
    results.push(result);
    console.log(` ${result.runtime}ms`);

    printMetrics("Routes", result.routes);
    printMetrics("Models", result.models);
    printMetrics("Env vars", result.envVars);
    if (result.components) printMetrics("Components", result.components);
    if (result.middleware) printMetrics("Middleware", result.middleware);
    console.log("");

    // Accumulate for averages
    const metrics = [result.routes, result.models, result.envVars];
    if (result.components) metrics.push(result.components);
    if (result.middleware) metrics.push(result.middleware);

    for (const m of metrics) {
      totalPrecision += m.precision;
      totalRecall += m.recall;
      totalF1 += m.f1;
      metricCount++;
    }
  }

  if (results.length === 0) {
    console.log("  No fixtures found. Add fixtures to eval/fixtures/");
    return;
  }

  // Summary
  const avgP = totalPrecision / metricCount;
  const avgR = totalRecall / metricCount;
  const avgF1 = totalF1 / metricCount;
  const totalRuntime = results.reduce((s, r) => s + r.runtime, 0);

  console.log("  ──────────────────────────────────────────");
  console.log(`  Fixtures:           ${results.length}`);
  console.log(`  Avg precision:      ${formatPercent(avgP)}`);
  console.log(`  Avg recall:         ${formatPercent(avgR)}`);
  console.log(`  Avg F1:             ${formatPercent(avgF1)}`);
  console.log(`  Total runtime:      ${totalRuntime}ms`);
  console.log("");
}
