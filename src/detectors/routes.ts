import { relative, basename } from "node:path";
import { readFileSafe } from "../scanner.js";
import type { RouteInfo, Framework, ProjectInfo } from "../types.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

const TAG_PATTERNS: [string, RegExp[]][] = [
  ["auth", [/auth/i, /jwt/i, /token/i, /session/i, /bearer/i, /passport/i, /clerk/i, /betterAuth/i, /better-auth/i]],
  ["db", [/prisma/i, /drizzle/i, /typeorm/i, /sequelize/i, /mongoose/i, /knex/i, /sql/i, /\.query\(/i, /\.execute\(/i, /\.findMany\(/i, /\.findFirst\(/i, /\.insert\(/i, /\.update\(/i, /\.delete\(/i]],
  ["cache", [/redis/i, /cache/i, /memcache/i, /\.setex\(/i, /\.getex\(/i]],
  ["queue", [/bullmq/i, /bull\b/i, /\.add\(\s*['"`]/i, /queue/i]],
  ["email", [/resend/i, /sendgrid/i, /nodemailer/i, /\.send\(\s*\{[\s\S]*?to:/i]],
  ["payment", [/stripe/i, /polar/i, /paddle/i, /lemon/i, /checkout/i, /webhook/i]],
  ["upload", [/multer/i, /formidable/i, /busboy/i, /upload/i, /multipart/i]],
  ["ai", [/openai/i, /anthropic/i, /claude/i, /\.chat\.completions/i, /\.messages\.create/i]],
];

function detectTags(content: string): string[] {
  const tags: string[] = [];
  for (const [tag, patterns] of TAG_PATTERNS) {
    if (patterns.some((p) => p.test(content))) {
      tags.push(tag);
    }
  }
  return tags;
}

export async function detectRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  for (const fw of project.frameworks) {
    switch (fw) {
      case "next-app":
        routes.push(...(await detectNextAppRoutes(files, project)));
        break;
      case "next-pages":
        routes.push(...(await detectNextPagesApi(files, project)));
        break;
      case "hono":
        routes.push(...(await detectHonoRoutes(files, project)));
        break;
      case "express":
        routes.push(...(await detectExpressRoutes(files, project)));
        break;
      case "fastify":
        routes.push(...(await detectFastifyRoutes(files, project)));
        break;
      case "koa":
        routes.push(...(await detectKoaRoutes(files, project)));
        break;
      case "fastapi":
        routes.push(...(await detectFastAPIRoutes(files, project)));
        break;
      case "flask":
        routes.push(...(await detectFlaskRoutes(files, project)));
        break;
      case "django":
        routes.push(...(await detectDjangoRoutes(files, project)));
        break;
      case "gin":
      case "go-net-http":
      case "fiber":
        routes.push(...(await detectGoRoutes(files, project, fw)));
        break;
    }
  }

  return routes;
}

// --- Next.js App Router ---
async function detectNextAppRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const routeFiles = files.filter(
    (f) => f.match(/\/app\/.*\/route\.(ts|js|tsx|jsx)$/) || f.match(/\/app\/route\.(ts|js|tsx|jsx)$/)
  );
  const routes: RouteInfo[] = [];

  for (const file of routeFiles) {
    const content = await readFileSafe(file);
    const rel = relative(project.root, file);
    // Extract API path from file path
    const pathMatch = rel.match(/(?:src\/)?app(.*)\/route\./);
    const apiPath = pathMatch ? pathMatch[1] || "/" : "/";

    for (const method of HTTP_METHODS) {
      const pattern = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${method}\\b`
      );
      if (pattern.test(content)) {
        routes.push({
          method,
          path: apiPath,
          file: rel,
          tags: detectTags(content),
          framework: "next-app",
        });
      }
    }
  }

  return routes;
}

// --- Next.js Pages API ---
async function detectNextPagesApi(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const apiFiles = files.filter((f) =>
    f.match(/\/pages\/api\/.*\.(ts|js|tsx|jsx)$/)
  );
  const routes: RouteInfo[] = [];

  for (const file of apiFiles) {
    const content = await readFileSafe(file);
    const rel = relative(project.root, file);
    const pathMatch = rel.match(/(?:src\/)?pages(\/api\/.*)\.(?:ts|js|tsx|jsx)$/);
    let apiPath = pathMatch ? pathMatch[1] : "/api";
    apiPath = apiPath.replace(/\/index$/, "").replace(/\[([^\]]+)\]/g, ":$1");

    // Detect methods from handler
    const methods: string[] = [];
    for (const method of HTTP_METHODS) {
      if (content.includes(`req.method === '${method}'`) || content.includes(`req.method === "${method}"`)) {
        methods.push(method);
      }
    }
    if (methods.length === 0) methods.push("ALL");

    for (const method of methods) {
      routes.push({
        method,
        path: apiPath,
        file: rel,
        tags: detectTags(content),
        framework: "next-pages",
      });
    }
  }

  return routes;
}

// --- Hono ---
async function detectHonoRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const tsFiles = files.filter((f) => f.match(/\.(ts|js|tsx|jsx|mjs)$/));
  const routes: RouteInfo[] = [];

  for (const file of tsFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("hono") && !content.includes("Hono")) continue;

    const rel = relative(project.root, file);

    // Match: app.get("/path", ...), router.post("/path", ...), .route("/base", ...)
    const routePattern =
      /\.\s*(get|post|put|patch|delete|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const path = match[2];
      // Skip non-path strings (middleware keys like "user", "userId", etc.)
      if (!path.startsWith("/") && !path.startsWith(":")) continue;
      routes.push({
        method: match[1].toUpperCase(),
        path,
        file: rel,
        tags: detectTags(content),
        framework: "hono",
      });
    }
  }

  return routes;
}

// --- Express ---
async function detectExpressRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const tsFiles = files.filter((f) => f.match(/\.(ts|js|mjs|cjs)$/));
  const routes: RouteInfo[] = [];

  for (const file of tsFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("express") && !content.includes("Router")) continue;

    const rel = relative(project.root, file);

    // Match: app.get("/path", ...), router.post("/path", ...)
    const routePattern =
      /(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
        tags: detectTags(content),
        framework: "express",
      });
    }
  }

  return routes;
}

// --- Fastify ---
async function detectFastifyRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const tsFiles = files.filter((f) => f.match(/\.(ts|js|mjs|cjs)$/));
  const routes: RouteInfo[] = [];

  for (const file of tsFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("fastify")) continue;

    const rel = relative(project.root, file);

    // Match: fastify.get("/path", ...) or server.route({ method: 'GET', url: '/path' })
    const routePattern =
      /(?:fastify|server|app)\s*\.\s*(get|post|put|patch|delete|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
        tags: detectTags(content),
        framework: "fastify",
      });
    }

    // Object-style route registration
    const objPattern =
      /\.route\s*\(\s*\{[\s\S]*?method:\s*['"`](\w+)['"`][\s\S]*?url:\s*['"`]([^'"`]+)['"`]/gi;
    while ((match = objPattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
        tags: detectTags(content),
        framework: "fastify",
      });
    }
  }

  return routes;
}

// --- Koa ---
async function detectKoaRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const tsFiles = files.filter((f) => f.match(/\.(ts|js|mjs|cjs)$/));
  const routes: RouteInfo[] = [];

  for (const file of tsFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("koa") && !content.includes("Router")) continue;

    const rel = relative(project.root, file);

    const routePattern =
      /router\s*\.\s*(get|post|put|patch|delete|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
        tags: detectTags(content),
        framework: "koa",
      });
    }
  }

  return routes;
}

// --- FastAPI ---
async function detectFastAPIRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  const routes: RouteInfo[] = [];

  for (const file of pyFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("fastapi") && !content.includes("FastAPI") && !content.includes("APIRouter")) continue;

    const rel = relative(project.root, file);

    // Match: @app.get("/path") or @router.post("/path") or @api_router.get("/path")
    const routePattern =
      /@\w+\s*\.\s*(get|post|put|patch|delete|options)\s*\(\s*['"]([^'"]+)['"]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: rel,
        tags: detectTags(content),
        framework: "fastapi",
      });
    }
  }

  return routes;
}

// --- Flask ---
async function detectFlaskRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  const routes: RouteInfo[] = [];

  for (const file of pyFiles) {
    const content = await readFileSafe(file);
    if (!content.includes("flask") && !content.includes("Flask") && !content.includes("Blueprint")) continue;

    const rel = relative(project.root, file);

    // Match: @app.route("/path", methods=["GET", "POST"])
    const routePattern =
      /@(?:app|bp|blueprint)\s*\.\s*route\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?\s*\)/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const path = match[1];
      const methods = match[2]
        ? match[2].match(/['"](\w+)['"]/g)?.map((m) => m.replace(/['"]/g, "").toUpperCase()) || ["GET"]
        : ["GET"];

      for (const method of methods) {
        routes.push({
          method,
          path,
          file: rel,
          tags: detectTags(content),
          framework: "flask",
        });
      }
    }
  }

  return routes;
}

// --- Django ---
async function detectDjangoRoutes(
  files: string[],
  project: ProjectInfo
): Promise<RouteInfo[]> {
  const pyFiles = files.filter(
    (f) => f.endsWith(".py") && (basename(f) === "urls.py" || basename(f) === "views.py")
  );
  const routes: RouteInfo[] = [];

  for (const file of pyFiles) {
    const content = await readFileSafe(file);
    const rel = relative(project.root, file);

    // Match: path("api/v1/users/", views.UserView.as_view())
    const pathPattern =
      /path\s*\(\s*['"]([^'"]*)['"]\s*,/g;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      routes.push({
        method: "ALL",
        path: "/" + match[1],
        file: rel,
        tags: detectTags(content),
        framework: "django",
      });
    }
  }

  return routes;
}

// --- Go ---
async function detectGoRoutes(
  files: string[],
  project: ProjectInfo,
  fw: Framework
): Promise<RouteInfo[]> {
  const goFiles = files.filter((f) => f.endsWith(".go"));
  const routes: RouteInfo[] = [];

  for (const file of goFiles) {
    const content = await readFileSafe(file);
    const rel = relative(project.root, file);

    if (fw === "gin") {
      // Match: r.GET("/path", handler)
      const pattern = /\.\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(\s*["']([^"']+)["']/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        routes.push({
          method: match[1],
          path: match[2],
          file: rel,
          tags: detectTags(content),
          framework: fw,
        });
      }
    } else if (fw === "fiber") {
      // Match: app.Get("/path", handler)
      const pattern = /\.\s*(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*["']([^"']+)["']/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        routes.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: rel,
          tags: detectTags(content),
          framework: fw,
        });
      }
    } else {
      // net/http: http.HandleFunc("/path", handler) or mux.HandleFunc("/path", handler)
      const pattern =
        /(?:HandleFunc|Handle)\s*\(\s*["']([^"']+)["']/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        routes.push({
          method: "ALL",
          path: match[1],
          file: rel,
          tags: detectTags(content),
          framework: fw,
        });
      }
    }
  }

  return routes;
}
