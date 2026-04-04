import { relative, dirname, resolve, extname } from "node:path";
import { readFileSafe } from "../scanner.js";
import type { DependencyGraph, ImportEdge, ProjectInfo } from "../types.js";

export async function detectDependencyGraph(
  files: string[],
  project: ProjectInfo
): Promise<DependencyGraph> {
  const edges: ImportEdge[] = [];
  const importCount = new Map<string, number>();

  const codeFiles = files.filter((f) =>
    f.match(/\.(ts|tsx|js|jsx|mjs|py|go)$/)
  );

  for (const file of codeFiles) {
    const content = await readFileSafe(file);
    if (!content) continue;

    const rel = relative(project.root, file);
    const ext = extname(file);

    if (ext === ".py") {
      extractPythonImports(content, rel, edges, importCount);
    } else if (ext === ".go") {
      extractGoImports(content, rel, edges, importCount);
    } else {
      extractTSImports(content, rel, file, project, files, edges, importCount);
    }
  }

  // Sort by most imported
  const hotFiles = Array.from(importCount.entries())
    .map(([file, count]) => ({ file, importedBy: count }))
    .sort((a, b) => b.importedBy - a.importedBy)
    .slice(0, 20);

  return { edges, hotFiles };
}

function extractTSImports(
  content: string,
  rel: string,
  absPath: string,
  project: ProjectInfo,
  allFiles: string[],
  edges: ImportEdge[],
  importCount: Map<string, number>
) {
  // Match: import ... from "./path" or import("./path") or require("./path")
  const patterns = [
    /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];

      // Only track local imports (starting with . or @/ alias)
      if (!importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("~/")) continue;

      // Resolve to relative path
      let resolvedPath: string;
      if (importPath.startsWith("@/") || importPath.startsWith("~/")) {
        resolvedPath = importPath.replace(/^[@~]\//, "src/");
      } else {
        const dir = dirname(absPath);
        resolvedPath = relative(project.root, resolve(dir, importPath));
      }

      // Strip extension and try to find the actual file
      const normalized = normalizeImportPath(resolvedPath, allFiles, project.root);
      if (normalized && normalized !== rel) {
        edges.push({ from: rel, to: normalized });
        importCount.set(normalized, (importCount.get(normalized) || 0) + 1);
      }
    }
  }
}

function extractPythonImports(
  content: string,
  rel: string,
  edges: ImportEdge[],
  importCount: Map<string, number>
) {
  // from .module import something or from ..package.module import something
  const fromPattern = /^from\s+(\.+\w[\w.]*)\s+import/gm;
  let match;
  while ((match = fromPattern.exec(content)) !== null) {
    const target = match[1].replace(/\./g, "/") + ".py";
    edges.push({ from: rel, to: target });
    importCount.set(target, (importCount.get(target) || 0) + 1);
  }
}

function extractGoImports(
  content: string,
  rel: string,
  edges: ImportEdge[],
  importCount: Map<string, number>
) {
  // Go doesn't have relative imports in the same way, but we can track internal package imports
  const importBlock = content.match(/import\s*\(([\s\S]*?)\)/);
  if (!importBlock) return;

  // Look for internal package paths (not standard library)
  const lines = importBlock[1].split("\n");
  for (const line of lines) {
    const pathMatch = line.match(/["']([^"']+)["']/);
    if (pathMatch && pathMatch[1].includes("/") && !pathMatch[1].startsWith("github.com") && !pathMatch[1].includes(".")) {
      const target = pathMatch[1];
      edges.push({ from: rel, to: target });
      importCount.set(target, (importCount.get(target) || 0) + 1);
    }
  }
}

function normalizeImportPath(
  importPath: string,
  allFiles: string[],
  root: string
): string | null {
  // Try exact match first
  for (const file of allFiles) {
    const rel = relative(root, file);
    if (rel === importPath) return rel;
  }

  // Try with extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
  for (const ext of extensions) {
    for (const file of allFiles) {
      const rel = relative(root, file);
      if (rel === importPath + ext) return rel;
    }
  }

  // Try index files
  for (const ext of extensions) {
    for (const file of allFiles) {
      const rel = relative(root, file);
      if (rel === importPath + "/index" + ext) return rel;
    }
  }

  return null;
}
