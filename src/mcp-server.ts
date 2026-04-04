import { resolve } from "node:path";
import { collectFiles, detectProject } from "./scanner.js";
import { detectRoutes } from "./detectors/routes.js";
import { detectSchemas } from "./detectors/schema.js";
import { detectComponents } from "./detectors/components.js";
import { detectLibs } from "./detectors/libs.js";
import { detectConfig } from "./detectors/config.js";
import { detectMiddleware } from "./detectors/middleware.js";
import { detectDependencyGraph } from "./detectors/graph.js";
import { enrichRouteContracts } from "./detectors/contracts.js";
import { calculateTokenStats } from "./detectors/tokens.js";
import { writeOutput } from "./formatter.js";
import type { ScanResult } from "./types.js";

/**
 * Minimal MCP (Model Context Protocol) server over stdio.
 * Implements JSON-RPC 2.0 with MCP protocol — no external dependencies.
 *
 * Exposes one tool: "codesight_scan" that scans a directory and returns
 * the full AI context map.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function send(msg: JsonRpcResponse) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  process.stdout.write(header + json);
}

async function runScan(directory: string): Promise<string> {
  const root = resolve(directory || process.cwd());

  const project = await detectProject(root);
  const files = await collectFiles(root, 10);

  const [rawRoutes, schemas, components, libs, config, middleware, graph] =
    await Promise.all([
      detectRoutes(files, project),
      detectSchemas(files, project),
      detectComponents(files, project),
      detectLibs(files, project),
      detectConfig(files, project),
      detectMiddleware(files, project),
      detectDependencyGraph(files, project),
    ]);

  const routes = await enrichRouteContracts(rawRoutes, project);

  const tempResult: ScanResult = {
    project,
    routes,
    schemas,
    components,
    libs,
    config,
    middleware,
    graph,
    tokenStats: { outputTokens: 0, estimatedExplorationTokens: 0, saved: 0, fileCount: files.length },
  };

  const outputContent = await writeOutput(tempResult, resolve(root, ".codesight"));
  const tokenStats = calculateTokenStats(tempResult, outputContent, files.length);

  return outputContent.replace(
    /Saves ~\d[\d,]* tokens/,
    `Saves ~${tokenStats.saved.toLocaleString()} tokens`
  );
}

async function handleRequest(req: JsonRpcRequest) {
  // MCP initialize
  if (req.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: req.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "codesight", version: "1.0.0" },
      },
    });
    return;
  }

  // MCP initialized notification
  if (req.method === "notifications/initialized") {
    return; // no response for notifications
  }

  // List tools
  if (req.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: req.id ?? null,
      result: {
        tools: [
          {
            name: "codesight_scan",
            description:
              "Scans a codebase and returns a complete AI context map including routes, database schema, components, libraries, config, middleware, and dependency graph. Saves thousands of tokens vs manual exploration.",
            inputSchema: {
              type: "object",
              properties: {
                directory: {
                  type: "string",
                  description: "Directory to scan (defaults to current working directory)",
                },
              },
            },
          },
        ],
      },
    });
    return;
  }

  // Call tool
  if (req.method === "tools/call") {
    const toolName = req.params?.name;
    const args = req.params?.arguments || {};

    if (toolName === "codesight_scan") {
      try {
        const result = await runScan(args.directory || process.cwd());
        send({
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            content: [{ type: "text", text: result }],
          },
        });
      } catch (err: any) {
        send({
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            content: [{ type: "text", text: `Error scanning: ${err.message}` }],
            isError: true,
          },
        });
      }
      return;
    }

    send({
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    });
    return;
  }

  // Unknown method
  if (req.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    });
  }
}

export async function startMCPServer() {
  // Read Content-Length delimited JSON-RPC messages from stdin
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;

    while (true) {
      // Parse Content-Length header
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.substring(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.substring(bodyStart, bodyStart + contentLength);
      buffer = buffer.substring(bodyStart + contentLength);

      try {
        const req = JSON.parse(body) as JsonRpcRequest;
        await handleRequest(req);
      } catch (err: any) {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
      }
    }
  });

  // Keep alive
  await new Promise(() => {});
}
