# codesight

See your codebase clearly. One command gives your AI assistant complete project understanding.

```bash
npx codesight
```

**Works with Claude Code, Cursor, GitHub Copilot, OpenAI Codex, Windsurf, Cline, and any AI coding tool.**

## The Problem

Every AI coding conversation starts the same way: your assistant burns thousands of tokens exploring files, grepping for patterns, and reading configs just to understand your project. On a 65-route Hono API with 18 Drizzle models, that costs **~68,000 tokens per conversation** in exploration alone.

codesight pre-generates that understanding into ~4,000 tokens of structured context. **Your AI starts every conversation already knowing your routes, schema, components, dependencies, and architecture.**

## Quick Start

```bash
npx codesight              # Scan and generate context
npx codesight --init       # Also generate CLAUDE.md, .cursorrules, codex.md, AGENTS.md
npx codesight --open       # Also open interactive HTML report in browser
```

## What It Generates

```
.codesight/
  CODESIGHT.md     # Combined AI context map (point your assistant here)
  routes.md        # API routes with methods, params, request/response types, tags
  schema.md        # Database models with fields, types, PKs, FKs, relations
  components.md    # UI components with props (shadcn/radix filtered out)
  libs.md          # Library exports with function signatures
  config.md        # Env vars (required vs default), config files, key deps
  middleware.md    # Auth, rate limiting, CORS, validation, logging
  graph.md         # Dependency graph: most-imported files + import map
  report.html      # Interactive visual report (with --html or --open)
```

## Real Output Example

From a production SaaS monorepo (Hono + Drizzle + React):

```markdown
# acme-saas — AI Context Map

> **Stack:** hono | drizzle | react | typescript
> **Monorepo:** @acme/api, @acme/dashboard, @acme/shared

> 48 routes | 12 models | 22 components | 31 lib files | 18 env vars | 6 middleware | 67 import links
> **Token savings:** this file is ~3,200 tokens. Without it, AI exploration would cost ~52,000 tokens.
> **Saves ~48,800 tokens per conversation.**

---

# Routes

- `POST` `/auth/login` [auth, db, email]
- `POST` `/auth/register` [auth, db, email]
- `GET` `/auth/me` [auth, db]
- `GET` `/api/projects` [auth, db]
- `POST` `/api/projects` [auth, db]
- `GET` `/api/projects/:id/analytics` params(id) [auth, db, cache]
- `POST` `/api/billing/checkout` [auth, db, payment]
- `POST` `/api/webhooks/stripe` [payment]
...

# Schema

### users
- id: uuid (pk, default)
- email: text (unique, required)
- name: text
- plan: text (required, default)
- stripeCustomerId: text (fk)

### projects
- id: uuid (pk, default)
- userId: uuid (fk)
- name: text (required)
- domain: text (unique)
- _relations_: userId -> users.id

### events
- id: uuid (pk, default)
- projectId: uuid (fk)
- type: text (required)
- payload: jsonb (required)
...

# Dependency Graph

## Most Imported Files (change these carefully)
- `packages/shared/src/index.ts` — imported by **14** files
- `apps/api/src/lib/db.ts` — imported by **9** files
- `apps/api/src/lib/auth.ts` — imported by **7** files
- `apps/api/src/lib/stripe.ts` — imported by **5** files
```

## What It Detects

| Category | Supported |
|---|---|
| **Routes** | Hono, Express, Fastify, Next.js (App + Pages), Koa, FastAPI, Flask, Django, Go (net/http, Gin, Fiber) |
| **Schema** | Drizzle, Prisma, TypeORM, SQLAlchemy |
| **Components** | React, Vue, Svelte (filters out shadcn/radix primitives) |
| **Libraries** | TypeScript/JavaScript, Python, Go exports with function signatures |
| **Config** | Environment variables (required vs defaults), config files, notable dependencies |
| **Middleware** | Auth, rate limiting, CORS, validation, logging, error handlers |
| **Dependencies** | Import graph with hot file detection (most imported = highest blast radius) |
| **Contracts** | URL params, request types, response types extracted from route handlers |
| **Monorepos** | pnpm, npm, yarn workspaces with cross-workspace detection |
| **Languages** | TypeScript, JavaScript, Python, Go |

## Auto-Generate AI Config Files

```bash
npx codesight --init
```

Generates instruction files for every major AI coding tool:

| File | Tool |
|---|---|
| `CLAUDE.md` | Claude Code |
| `.cursorrules` | Cursor |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `codex.md` | OpenAI Codex CLI |
| `AGENTS.md` | OpenAI Codex |

Each file includes your project's stack, key architecture facts, hot files, and required env vars so your AI assistant knows the project from the first message.

## Interactive HTML Report

```bash
npx codesight --open
```

Generates a visual dashboard with:
- Token savings hero metric
- Route table with methods, contracts, and tags
- Schema cards with fields and relations
- Dependency hot files with impact bars
- Environment variables (required vs defaults)
- Full middleware map

Screenshots of this report are what go viral on Twitter.

## MCP Server

```bash
npx codesight --mcp
```

Runs as a Model Context Protocol server that Claude Code and Cursor can connect to. Add to your MCP config:

```json
{
  "mcpServers": {
    "codesight": {
      "command": "npx",
      "args": ["codesight", "--mcp"]
    }
  }
}
```

Your AI assistant can then call the `codesight_scan` tool to get full project context on demand.

## Watch Mode

```bash
npx codesight --watch
```

Re-scans automatically when files change. Keeps context fresh during development.

## Git Pre-Commit Hook

```bash
npx codesight --hook
```

Installs a git pre-commit hook that regenerates context on every commit. Context stays up to date automatically.

## All Options

```bash
npx codesight                       # Scan current directory
npx codesight ./my-project          # Scan specific directory
npx codesight --init                # Generate AI config files
npx codesight --open                # Open interactive HTML report
npx codesight --html                # Generate HTML report (no open)
npx codesight --mcp                 # Start MCP server
npx codesight --watch               # Watch mode
npx codesight --hook                # Install git pre-commit hook
npx codesight --json                # Output JSON
npx codesight -o .ai-context        # Custom output directory
npx codesight -d 5                  # Limit directory depth
```

## Why Not Repomix?

Repomix dumps your entire codebase into one file. codesight maps your architecture.

| | Repomix | codesight |
|---|---|---|
| **Approach** | Raw code dump | Structured intelligence |
| **Output** | One giant text blob | Semantic context files |
| **AI gets** | "Here is all the code" | "Here is the architecture" |
| **Token cost** | Huge (entire codebase) | Tiny (~4K tokens for full map) |
| **Route discovery** | Read every file | Instant from routes.md |
| **Schema understanding** | Read every migration | Instant from schema.md |
| **Change blast radius** | Unknown | Visible in dependency graph |
| **AI config generation** | No | CLAUDE.md, .cursorrules, codex.md, AGENTS.md |
| **Runtime deps** | 26 | **Zero** |

## Zero Dependencies

codesight has zero runtime dependencies. Just Node.js built-ins. Fast, portable, no supply chain risk.

## License

MIT
