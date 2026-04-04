/**
 * Token telemetry: measures real before/after token usage by simulating
 * what an AI agent would do with and without codesight context.
 *
 * Approach: for each standard task (explain architecture, add route, review diff),
 * measure the actual bytes of context that would be consumed.
 *
 * "Without codesight": count tokens from the files an AI would need to read
 * to discover routes, schema, components, config, etc.
 *
 * "With codesight": count tokens from the CODESIGHT.md output.
 */

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ScanResult } from "./types.js";

export interface TelemetryTask {
  name: string;
  description: string;
  /** Files the AI would need to read without codesight */
  filesRead: string[];
  /** Tool calls the AI would make (glob, grep, read) */
  toolCalls: number;
  /** Tokens consumed reading those files */
  tokensWithout: number;
  /** Tokens consumed from codesight output */
  tokensWith: number;
  /** Reduction factor */
  reduction: number;
}

export interface TelemetryReport {
  project: string;
  tasks: TelemetryTask[];
  summary: {
    totalTokensWithout: number;
    totalTokensWith: number;
    averageReduction: number;
    totalToolCallsSaved: number;
  };
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}


/**
 * Task 1: "Explain the architecture"
 * Without codesight: AI reads package.json, scans dirs, reads route files,
 * schema files, config files, middleware files — typically 15-25 file reads.
 */
async function measureExplainArchitecture(
  root: string,
  result: ScanResult,
  codesightTokens: number
): Promise<TelemetryTask> {
  const filesToRead = new Set<string>();

  // AI would read package.json first
  filesToRead.add(join(root, "package.json"));

  // Then scan for route files
  for (const route of result.routes) {
    filesToRead.add(join(root, route.file));
  }

  // Schema files
  for (const _schema of result.schemas) {
    // Find the file containing this schema from routes or libs
    for (const lib of result.libs) {
      if (lib.file.includes("schema") || lib.file.includes("model") || lib.file.includes("db")) {
        filesToRead.add(join(root, lib.file));
      }
    }
  }

  // Config files
  for (const cf of result.config.configFiles) {
    filesToRead.add(join(root, cf));
  }

  // Middleware files
  for (const mw of result.middleware) {
    filesToRead.add(join(root, mw.file));
  }

  // Hot files (AI would discover these during exploration)
  for (const hf of result.graph.hotFiles.slice(0, 10)) {
    filesToRead.add(join(root, hf.file));
  }

  // Read all files and count tokens
  let totalTokens = 0;
  const readFiles: string[] = [];
  for (const f of filesToRead) {
    const content = await readFileSafe(f);
    if (content) {
      totalTokens += countTokens(content);
      readFiles.push(relative(root, f));
    }
  }

  // Add overhead for glob/grep tool calls (each costs ~50-100 tokens for command + results)
  const toolCalls = Math.max(10, Math.ceil(filesToRead.size * 0.8));
  totalTokens += toolCalls * 75; // average 75 tokens per tool call overhead

  const reduction = totalTokens > 0 ? Math.round((totalTokens / codesightTokens) * 10) / 10 : 1;

  return {
    name: "Explain architecture",
    description: "Understand project stack, routes, schema, and dependencies",
    filesRead: readFiles,
    toolCalls,
    tokensWithout: totalTokens,
    tokensWith: codesightTokens,
    reduction,
  };
}

/**
 * Task 2: "Add a new API route"
 * Without codesight: AI needs to find existing routes to match patterns,
 * read schema for related models, check middleware, check config.
 */
async function measureAddRoute(
  root: string,
  result: ScanResult,
  codesightTokens: number
): Promise<TelemetryTask> {
  const filesToRead = new Set<string>();

  // AI would grep for existing route patterns — reads 3-5 route files
  const routeFiles = [...new Set(result.routes.map((r) => r.file))];
  for (const f of routeFiles.slice(0, 5)) {
    filesToRead.add(join(root, f));
  }

  // Read schema to understand models
  for (const lib of result.libs) {
    if (lib.file.includes("schema") || lib.file.includes("model") || lib.file.includes("db")) {
      filesToRead.add(join(root, lib.file));
    }
  }

  // Check middleware to know what to apply
  for (const mw of result.middleware) {
    filesToRead.add(join(root, mw.file));
  }

  let totalTokens = 0;
  const readFiles: string[] = [];
  for (const f of filesToRead) {
    const content = await readFileSafe(f);
    if (content) {
      totalTokens += countTokens(content);
      readFiles.push(relative(root, f));
    }
  }

  const toolCalls = Math.max(6, Math.ceil(filesToRead.size * 0.7));
  totalTokens += toolCalls * 75;

  // With codesight, AI only reads the routes + schema sections (~40% of output)
  const withTokens = Math.ceil(codesightTokens * 0.4);
  const reduction = totalTokens > 0 ? Math.round((totalTokens / withTokens) * 10) / 10 : 1;

  return {
    name: "Add new API route",
    description: "Find route patterns, check schema, apply middleware",
    filesRead: readFiles,
    toolCalls,
    tokensWithout: totalTokens,
    tokensWith: withTokens,
    reduction,
  };
}

/**
 * Task 3: "Review a diff / understand blast radius"
 * Without codesight: AI needs to trace imports, find dependents, check what routes
 * and models are affected by a file change.
 */
async function measureReviewDiff(
  root: string,
  result: ScanResult,
  codesightTokens: number
): Promise<TelemetryTask> {
  const filesToRead = new Set<string>();

  // AI would read the changed file + all its importers
  // Simulate: pick the hottest file and trace its dependents
  if (result.graph.hotFiles.length > 0) {
    const hotFile = result.graph.hotFiles[0];
    filesToRead.add(join(root, hotFile.file));

    // Read files that import it
    for (const edge of result.graph.edges) {
      if (edge.to === hotFile.file) {
        filesToRead.add(join(root, edge.from));
      }
    }
  }

  // Also read some route files to check impact
  const routeFiles = [...new Set(result.routes.map((r) => r.file))];
  for (const f of routeFiles.slice(0, 3)) {
    filesToRead.add(join(root, f));
  }

  let totalTokens = 0;
  const readFiles: string[] = [];
  for (const f of filesToRead) {
    const content = await readFileSafe(f);
    if (content) {
      totalTokens += countTokens(content);
      readFiles.push(relative(root, f));
    }
  }

  const toolCalls = Math.max(8, Math.ceil(filesToRead.size * 0.6));
  totalTokens += toolCalls * 75;

  // With codesight, AI reads graph section + routes (~50% of output)
  const withTokens = Math.ceil(codesightTokens * 0.5);
  const reduction = totalTokens > 0 ? Math.round((totalTokens / withTokens) * 10) / 10 : 1;

  return {
    name: "Review diff / blast radius",
    description: "Trace imports, find affected routes and models",
    filesRead: readFiles,
    toolCalls,
    tokensWithout: totalTokens,
    tokensWith: withTokens,
    reduction,
  };
}

export async function runTelemetry(
  root: string,
  result: ScanResult,
  outputDir: string
): Promise<TelemetryReport> {
  // Read the codesight output to get real token count
  const codesightContent = await readFileSafe(join(outputDir, "CODESIGHT.md"));
  const codesightTokens = countTokens(codesightContent);

  const tasks = await Promise.all([
    measureExplainArchitecture(root, result, codesightTokens),
    measureAddRoute(root, result, codesightTokens),
    measureReviewDiff(root, result, codesightTokens),
  ]);

  const totalWithout = tasks.reduce((s, t) => s + t.tokensWithout, 0);
  const totalWith = tasks.reduce((s, t) => s + t.tokensWith, 0);
  const totalToolCalls = tasks.reduce((s, t) => s + t.toolCalls, 0);

  const report: TelemetryReport = {
    project: result.project.name,
    tasks,
    summary: {
      totalTokensWithout: totalWithout,
      totalTokensWith: totalWith,
      averageReduction: totalWith > 0 ? Math.round((totalWithout / totalWith) * 10) / 10 : 1,
      totalToolCallsSaved: totalToolCalls,
    },
  };

  // Write telemetry report
  const reportLines: string[] = [
    `# Token Telemetry: ${result.project.name}`,
    "",
    `> Measured by reading the actual files an AI agent would need for each task,`,
    `> then comparing against the codesight output (~${codesightTokens.toLocaleString()} tokens).`,
    "",
    "## Tasks",
    "",
  ];

  for (const task of tasks) {
    reportLines.push(`### ${task.name}`);
    reportLines.push(`_${task.description}_`);
    reportLines.push("");
    reportLines.push(`| Metric | Value |`);
    reportLines.push(`|---|---|`);
    reportLines.push(`| Files AI would read | ${task.filesRead.length} |`);
    reportLines.push(`| Tool calls (glob/grep/read) | ${task.toolCalls} |`);
    reportLines.push(`| Tokens without codesight | ~${task.tokensWithout.toLocaleString()} |`);
    reportLines.push(`| Tokens with codesight | ~${task.tokensWith.toLocaleString()} |`);
    reportLines.push(`| **Reduction** | **${task.reduction}x** |`);
    reportLines.push("");

    if (task.filesRead.length > 0) {
      reportLines.push("<details>");
      reportLines.push(`<summary>Files read (${task.filesRead.length})</summary>`);
      reportLines.push("");
      for (const f of task.filesRead) {
        reportLines.push(`- \`${f}\``);
      }
      reportLines.push("");
      reportLines.push("</details>");
      reportLines.push("");
    }
  }

  reportLines.push("## Summary");
  reportLines.push("");
  reportLines.push(`| Metric | Value |`);
  reportLines.push(`|---|---|`);
  reportLines.push(`| Total tokens without codesight | ~${report.summary.totalTokensWithout.toLocaleString()} |`);
  reportLines.push(`| Total tokens with codesight | ~${report.summary.totalTokensWith.toLocaleString()} |`);
  reportLines.push(`| **Average reduction** | **${report.summary.averageReduction}x** |`);
  reportLines.push(`| Tool calls saved | ${report.summary.totalToolCallsSaved} |`);
  reportLines.push("");
  reportLines.push("## Methodology");
  reportLines.push("");
  reportLines.push("Token counts are calculated by reading the actual source files an AI agent would");
  reportLines.push("need to explore for each task, using the ~4 chars/token heuristic (standard for");
  reportLines.push("GPT/Claude tokenizers). Tool call overhead is estimated at ~75 tokens per call");
  reportLines.push("(command text + result formatting). The \"with codesight\" count uses the real");
  reportLines.push("CODESIGHT.md output size, proportioned to the sections relevant to each task.");
  reportLines.push("");
  reportLines.push(`_Generated by codesight --telemetry_`);

  const { writeFile: wf } = await import("node:fs/promises");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outputDir, { recursive: true });
  await wf(join(outputDir, "telemetry.md"), reportLines.join("\n"));

  return report;
}
