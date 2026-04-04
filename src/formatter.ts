import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanResult } from "./types.js";

export async function writeOutput(
  result: ScanResult,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const sections: { name: string; content: string }[] = [];

  if (result.routes.length > 0) {
    const content = formatRoutes(result);
    sections.push({ name: "routes", content });
    await writeFile(join(outputDir, "routes.md"), content);
  }

  if (result.schemas.length > 0) {
    const content = formatSchema(result);
    sections.push({ name: "schema", content });
    await writeFile(join(outputDir, "schema.md"), content);
  }

  if (result.components.length > 0) {
    const content = formatComponents(result);
    sections.push({ name: "components", content });
    await writeFile(join(outputDir, "components.md"), content);
  }

  if (result.libs.length > 0) {
    const content = formatLibs(result);
    sections.push({ name: "libs", content });
    await writeFile(join(outputDir, "libs.md"), content);
  }

  const configContent = formatConfig(result);
  if (configContent) {
    sections.push({ name: "config", content: configContent });
    await writeFile(join(outputDir, "config.md"), configContent);
  }

  if (result.middleware.length > 0) {
    const content = formatMiddleware(result);
    sections.push({ name: "middleware", content });
    await writeFile(join(outputDir, "middleware.md"), content);
  }

  if (result.graph.hotFiles.length > 0) {
    const content = formatGraph(result);
    sections.push({ name: "graph", content });
    await writeFile(join(outputDir, "graph.md"), content);
  }

  const combined = formatCombined(result, sections);
  await writeFile(join(outputDir, "CODESIGHT.md"), combined);

  return combined;
}

function formatRoutes(result: ScanResult): string {
  const lines: string[] = ["# Routes", ""];

  const byFramework = new Map<string, typeof result.routes>();
  for (const route of result.routes) {
    const fw = route.framework;
    if (!byFramework.has(fw)) byFramework.set(fw, []);
    byFramework.get(fw)!.push(route);
  }

  for (const [fw, routes] of byFramework) {
    if (byFramework.size > 1) {
      lines.push(`## ${fw}`, "");
    }

    for (const route of routes) {
      const tags = route.tags.length > 0 ? ` [${route.tags.join(", ")}]` : "";
      const params = route.params ? ` params(${route.params.join(", ")})` : "";
      const contract: string[] = [];
      if (route.requestType) contract.push(`in: ${route.requestType}`);
      if (route.responseType) contract.push(`out: ${route.responseType}`);
      const contractStr = contract.length > 0 ? ` → ${contract.join(", ")}` : "";
      lines.push(`- \`${route.method}\` \`${route.path}\`${params}${contractStr}${tags}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatSchema(result: ScanResult): string {
  const lines: string[] = ["# Schema", ""];

  const byOrm = new Map<string, typeof result.schemas>();
  for (const model of result.schemas) {
    if (!byOrm.has(model.orm)) byOrm.set(model.orm, []);
    byOrm.get(model.orm)!.push(model);
  }

  for (const [orm, models] of byOrm) {
    if (byOrm.size > 1) lines.push(`## ${orm}`, "");

    for (const model of models) {
      if (model.name.startsWith("enum:")) {
        const enumName = model.name.replace("enum:", "");
        const values = model.fields.map((f) => f.name).join(" | ");
        lines.push(`### enum ${enumName}: ${values}`, "");
        continue;
      }

      lines.push(`### ${model.name}`);
      for (const field of model.fields) {
        const flags = field.flags.length > 0 ? ` (${field.flags.join(", ")})` : "";
        lines.push(`- ${field.name}: ${field.type}${flags}`);
      }
      if (model.relations.length > 0) {
        lines.push(`- _relations_: ${model.relations.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatComponents(result: ScanResult): string {
  const lines: string[] = ["# Components", ""];

  for (const comp of result.components) {
    const markers: string[] = [];
    if (comp.isClient) markers.push("client");
    if (comp.isServer) markers.push("server");
    const markerStr = markers.length > 0 ? ` [${markers.join(", ")}]` : "";

    if (comp.props.length > 0) {
      lines.push(`- **${comp.name}**${markerStr} — props: ${comp.props.join(", ")} — \`${comp.file}\``);
    } else {
      lines.push(`- **${comp.name}**${markerStr} — \`${comp.file}\``);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatLibs(result: ScanResult): string {
  const lines: string[] = ["# Libraries", ""];

  for (const lib of result.libs) {
    const maxExports = 6;
    const shown = lib.exports.slice(0, maxExports);
    const remaining = lib.exports.length - maxExports;

    if (lib.exports.length <= 2) {
      const exps = shown
        .map((e) => {
          const sig = e.signature ? `: ${e.signature}` : "";
          return `${e.kind} ${e.name}${sig}`;
        })
        .join(", ");
      lines.push(`- \`${lib.file}\` — ${exps}`);
    } else {
      lines.push(`- \`${lib.file}\``);
      for (const exp of shown) {
        const sig = exp.signature ? `: ${exp.signature}` : "";
        lines.push(`  - ${exp.kind} ${exp.name}${sig}`);
      }
      if (remaining > 0) lines.push(`  - _...${remaining} more_`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatConfig(result: ScanResult): string | null {
  const lines: string[] = ["# Config", ""];

  if (result.config.envVars.length > 0) {
    lines.push("## Environment Variables", "");
    for (const env of result.config.envVars) {
      const status = env.hasDefault ? "(has default)" : "**required**";
      lines.push(`- \`${env.name}\` ${status} — ${env.source}`);
    }
    lines.push("");
  }

  if (result.config.configFiles.length > 0) {
    lines.push("## Config Files", "");
    for (const f of result.config.configFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  const notableDeps = filterNotableDeps(result.config.dependencies);
  if (notableDeps.length > 0) {
    lines.push("## Key Dependencies", "");
    for (const [name, version] of notableDeps) {
      lines.push(`- ${name}: ${version}`);
    }
    lines.push("");
  }

  if (lines.length <= 2) return null;
  return lines.join("\n");
}

function formatMiddleware(result: ScanResult): string {
  const lines: string[] = ["# Middleware", ""];

  const byType = new Map<string, typeof result.middleware>();
  for (const mw of result.middleware) {
    if (!byType.has(mw.type)) byType.set(mw.type, []);
    byType.get(mw.type)!.push(mw);
  }

  for (const [type, mws] of byType) {
    lines.push(`## ${type}`);
    for (const mw of mws) {
      lines.push(`- ${mw.name} — \`${mw.file}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatGraph(result: ScanResult): string {
  const lines: string[] = ["# Dependency Graph", ""];

  lines.push("## Most Imported Files (change these carefully)", "");
  for (const hf of result.graph.hotFiles) {
    lines.push(`- \`${hf.file}\` — imported by **${hf.importedBy}** files`);
  }
  lines.push("");

  // Show top import edges grouped by target
  const edgesByTarget = new Map<string, string[]>();
  for (const edge of result.graph.edges) {
    if (!edgesByTarget.has(edge.to)) edgesByTarget.set(edge.to, []);
    edgesByTarget.get(edge.to)!.push(edge.from);
  }

  const topTargets = Array.from(edgesByTarget.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  if (topTargets.length > 0) {
    lines.push("## Import Map (who imports what)", "");
    for (const [target, importers] of topTargets) {
      const shown = importers.slice(0, 5);
      const more = importers.length > 5 ? ` +${importers.length - 5} more` : "";
      lines.push(`- \`${target}\` ← ${shown.map((i) => `\`${i}\``).join(", ")}${more}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatCombined(
  result: ScanResult,
  sections: { name: string; content: string }[]
): string {
  const lines: string[] = [];

  lines.push(`# ${result.project.name} — AI Context Map`);
  lines.push("");

  const fw = result.project.frameworks.join(", ") || "unknown";
  const orm = result.project.orms.join(", ") || "none";
  const lang = result.project.language;
  const compFw = result.project.componentFramework;

  lines.push(`> **Stack:** ${fw} | ${orm} | ${compFw} | ${lang}`);
  if (result.project.isMonorepo) {
    const wsNames = result.project.workspaces.map((w) => w.name).join(", ");
    lines.push(`> **Monorepo:** ${wsNames}`);
  }
  lines.push("");

  // Token stats
  const ts = result.tokenStats;
  lines.push(
    `> ${result.routes.length} routes | ${result.schemas.length} models | ${result.components.length} components | ${result.libs.length} lib files | ${result.config.envVars.length} env vars | ${result.middleware.length} middleware | ${result.graph.edges.length} import links`
  );
  lines.push(`> **Token savings:** this file is ~${ts.outputTokens.toLocaleString()} tokens. Without it, AI exploration would cost ~${ts.estimatedExplorationTokens.toLocaleString()} tokens. **Saves ~${ts.saved.toLocaleString()} tokens per conversation.**`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const section of sections) {
    lines.push(section.content);
    lines.push("---");
    lines.push("");
  }

  lines.push(
    `_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_`
  );

  return lines.join("\n");
}

function filterNotableDeps(deps: Record<string, string>): [string, string][] {
  const notable = new Set([
    "next", "react", "vue", "svelte", "hono", "express", "fastify", "koa",
    "drizzle-orm", "prisma", "@prisma/client", "typeorm", "tailwindcss",
    "stripe", "@polar-sh/sdk", "resend", "bullmq", "redis", "ioredis",
    "zod", "trpc", "@trpc/server", "better-auth", "@clerk/nextjs",
    "next-auth", "lucia", "passport", "@anthropic-ai/sdk", "openai",
    "ai", "langchain", "supabase", "@supabase/supabase-js", "mongoose",
    "pg", "mysql2", "better-sqlite3", "playwright", "puppeteer",
    "socket.io", "graphql", "@apollo/server",
  ]);

  return Object.entries(deps)
    .filter(([name]) => notable.has(name))
    .sort(([a], [b]) => a.localeCompare(b));
}
