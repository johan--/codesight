import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import type {
  Framework,
  ORM,
  ComponentFramework,
  ProjectInfo,
  WorkspaceInfo,
} from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  "out",
  ".output",
  "coverage",
  ".turbo",
  ".vercel",
  ".codesight",
  ".codescope",
  ".ai-codex",
  "vendor",
  ".cache",
  ".parcel-cache",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".vue",
  ".svelte",
]);

export async function collectFiles(
  root: string,
  maxDepth = 10
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".env.example" && entry.name !== ".env.local") continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (CODE_EXTENSIONS.has(ext) || entry.name === ".env" || entry.name === ".env.example" || entry.name === ".env.local") {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(root, 0);
  return files;
}

export async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

export async function detectProject(root: string): Promise<ProjectInfo> {
  const pkgPath = join(root, "package.json");
  let pkg: Record<string, any> = {};
  try {
    pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  } catch {}

  const name = pkg.name || basename(root);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Detect monorepo
  const isMonorepo = !!(pkg.workspaces || await fileExists(join(root, "pnpm-workspace.yaml")));
  const workspaces: WorkspaceInfo[] = [];
  if (isMonorepo) {
    const wsPatterns = await getWorkspacePatterns(root, pkg);
    for (const pattern of wsPatterns) {
      const wsRoot = join(root, pattern.replace("/*", ""));
      try {
        const wsDirs = await readdir(wsRoot, { withFileTypes: true });
        for (const d of wsDirs) {
          if (!d.isDirectory() || d.name.startsWith(".")) continue;
          const wsPath = join(wsRoot, d.name);
          const wsPkg = await readJsonSafe(join(wsPath, "package.json"));
          workspaces.push({
            name: wsPkg.name || d.name,
            path: relative(root, wsPath),
            frameworks: await detectFrameworks(wsPath, wsPkg),
            orms: await detectORMs(wsPath, wsPkg),
          });
        }
      } catch {}
    }
  }

  // For monorepos, aggregate all workspace deps for top-level detection
  let allDeps = { ...deps };
  if (isMonorepo) {
    for (const ws of workspaces) {
      const wsPkg = await readJsonSafe(join(root, ws.path, "package.json"));
      Object.assign(allDeps, wsPkg.dependencies, wsPkg.devDependencies);
    }
  }

  // Detect language
  const language = await detectLanguage(root, allDeps);

  // For monorepos, aggregate frameworks and orms from workspaces
  let frameworks = await detectFrameworks(root, pkg);
  let orms = await detectORMs(root, pkg);
  if (isMonorepo) {
    for (const ws of workspaces) {
      for (const fw of ws.frameworks) {
        if (!frameworks.includes(fw)) frameworks.push(fw);
      }
      for (const orm of ws.orms) {
        if (!orms.includes(orm)) orms.push(orm);
      }
    }
  }

  return {
    root,
    name,
    frameworks,
    orms,
    componentFramework: detectComponentFramework(allDeps),
    isMonorepo,
    workspaces,
    language,
  };
}

async function detectFrameworks(
  root: string,
  pkg: Record<string, any>
): Promise<Framework[]> {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const frameworks: Framework[] = [];

  // Next.js
  if (deps["next"]) {
    const hasAppDir =
      (await fileExists(join(root, "app"))) ||
      (await fileExists(join(root, "src/app")));
    const hasPagesDir =
      (await fileExists(join(root, "pages"))) ||
      (await fileExists(join(root, "src/pages")));
    if (hasAppDir) frameworks.push("next-app");
    if (hasPagesDir) frameworks.push("next-pages");
    if (!hasAppDir && !hasPagesDir) frameworks.push("next-app");
  }

  // Hono
  if (deps["hono"]) frameworks.push("hono");

  // Express
  if (deps["express"]) frameworks.push("express");

  // Fastify
  if (deps["fastify"]) frameworks.push("fastify");

  // Koa
  if (deps["koa"]) frameworks.push("koa");

  // Python frameworks - check for requirements.txt or pyproject.toml
  const pyDeps = await getPythonDeps(root);
  if (pyDeps.includes("flask")) frameworks.push("flask");
  if (pyDeps.includes("fastapi")) frameworks.push("fastapi");
  if (pyDeps.includes("django")) frameworks.push("django");

  // Go frameworks - check go.mod
  const goDeps = await getGoDeps(root);
  if (goDeps.includes("net/http")) frameworks.push("go-net-http");
  if (goDeps.includes("gin-gonic/gin")) frameworks.push("gin");
  if (goDeps.includes("gofiber/fiber")) frameworks.push("fiber");

  return frameworks;
}

async function detectORMs(
  root: string,
  pkg: Record<string, any>
): Promise<ORM[]> {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const orms: ORM[] = [];

  if (deps["drizzle-orm"]) orms.push("drizzle");
  if (deps["prisma"] || deps["@prisma/client"]) orms.push("prisma");
  if (deps["typeorm"]) orms.push("typeorm");

  const pyDeps = await getPythonDeps(root);
  if (pyDeps.includes("sqlalchemy")) orms.push("sqlalchemy");

  const goDeps = await getGoDeps(root);
  if (goDeps.some((d) => d.includes("gorm"))) orms.push("gorm");

  return orms;
}

function detectComponentFramework(
  deps: Record<string, string>
): ComponentFramework {
  if (deps["react"] || deps["react-dom"]) return "react";
  if (deps["vue"]) return "vue";
  if (deps["svelte"]) return "svelte";
  return "unknown";
}

async function detectLanguage(
  root: string,
  deps: Record<string, string>
): Promise<"typescript" | "javascript" | "python" | "go" | "mixed"> {
  const hasTsConfig = await fileExists(join(root, "tsconfig.json"));
  const hasPyProject = await fileExists(join(root, "pyproject.toml")) || await fileExists(join(root, "backend/pyproject.toml"));
  const hasGoMod = await fileExists(join(root, "go.mod"));
  const hasRequirements = await fileExists(join(root, "requirements.txt")) || await fileExists(join(root, "backend/requirements.txt"));

  const langs: string[] = [];
  if (hasTsConfig || deps["typescript"]) langs.push("typescript");
  if (hasPyProject || hasRequirements) langs.push("python");
  if (hasGoMod) langs.push("go");

  if (langs.length > 1) return "mixed";
  if (langs[0] === "typescript") return "typescript";
  if (langs[0] === "python") return "python";
  if (langs[0] === "go") return "go";
  return "javascript";
}

async function getWorkspacePatterns(
  root: string,
  pkg: Record<string, any>
): Promise<string[]> {
  // pnpm-workspace.yaml
  try {
    const yaml = await readFile(join(root, "pnpm-workspace.yaml"), "utf-8");
    const patterns: string[] = [];
    for (const line of yaml.split("\n")) {
      const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
      if (match) patterns.push(match[1]);
    }
    if (patterns.length > 0) return patterns;
  } catch {}

  // package.json workspaces
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg.workspaces?.packages) return pkg.workspaces.packages;

  return [];
}

async function getPythonDeps(root: string): Promise<string[]> {
  const deps: string[] = [];
  // Check root and common subdirectories
  const searchDirs = [root, join(root, "backend"), join(root, "api"), join(root, "server"), join(root, "src")];
  for (const dir of searchDirs) {
    try {
      const req = await readFile(join(dir, "requirements.txt"), "utf-8");
      for (const line of req.split("\n")) {
        const name = line.split(/[>=<\[]/)[0].trim().toLowerCase();
        if (name && !deps.includes(name)) deps.push(name);
      }
    } catch {}
    try {
      const toml = await readFile(join(dir, "pyproject.toml"), "utf-8");
      const depSection = toml.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depSection) {
        for (const match of depSection[1].matchAll(/"([^"]+)"/g)) {
          const name = match[1].split(/[>=<\[]/)[0].trim().toLowerCase();
          if (!deps.includes(name)) deps.push(name);
        }
      }
    } catch {}
  }
  return deps;
}

async function getGoDeps(root: string): Promise<string[]> {
  const deps: string[] = [];
  try {
    const gomod = await readFile(join(root, "go.mod"), "utf-8");
    for (const line of gomod.split("\n")) {
      const match = line.match(/^\s*([\w./-]+)\s+v/);
      if (match) deps.push(match[1]);
    }
    // Check for net/http usage in main.go
    try {
      const main = await readFile(join(root, "main.go"), "utf-8");
      if (main.includes("net/http")) deps.push("net/http");
    } catch {}
  } catch {}
  return deps;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}
