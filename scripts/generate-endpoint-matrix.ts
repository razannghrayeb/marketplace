import fs from "fs";
import path from "path";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface MountedRouter {
  mountPath: string;
  symbol: string;
  sourcePath: string;
  resolvedFile: string;
  routeFile: string;
}

interface EndpointRow {
  method: HttpMethod;
  path: string;
  mountPath: string;
  sourceFile: string;
}

const METHOD_ORDER: Record<HttpMethod, number> = {
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
};

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function normalizeFullPath(mountPath: string, routePath: string): string {
  const left = mountPath.endsWith("/") ? mountPath.slice(0, -1) : mountPath;

  if (routePath === "/") {
    return left || "/";
  }

  const right = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const combined = `${left}${right}`.replace(/\/\/+/, "/");
  return combined || "/";
}

function resolveModuleFile(fromDir: string, modulePath: string): string {
  const absBase = path.resolve(fromDir, modulePath);
  const candidates = [
    `${absBase}.ts`,
    `${absBase}.tsx`,
    path.join(absBase, "index.ts"),
    path.join(absBase, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve module path: ${modulePath} (from ${fromDir})`);
}

function parseImports(serverFileContent: string): Map<string, string> {
  const map = new Map<string, string>();

  // Default imports: import foo from "./bar";
  const defaultImportRegex = /^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'](.+?)["'];?$/gm;
  for (const match of serverFileContent.matchAll(defaultImportRegex)) {
    map.set(match[1], match[2]);
  }

  // Named imports: import { a, b as c } from "./bar";
  const namedImportRegex = /^import\s+\{\s*([^}]+)\s*\}\s+from\s+["'](.+?)["'];?$/gm;
  for (const match of serverFileContent.matchAll(namedImportRegex)) {
    const spec = match[1];
    const modulePath = match[2];
    const names = spec.split(",").map((s) => s.trim()).filter(Boolean);

    for (const name of names) {
      const aliasParts = name.split(/\s+as\s+/i).map((s) => s.trim());
      const localName = aliasParts.length === 2 ? aliasParts[1] : aliasParts[0];
      map.set(localName, modulePath);
    }
  }

  return map;
}

function parseMountedRouters(serverFileContent: string): Array<{ mountPath: string; symbol: string }> {
  const mounts: Array<{ mountPath: string; symbol: string }> = [];
  const appUseRegex = /app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;

  for (const match of serverFileContent.matchAll(appUseRegex)) {
    mounts.push({ mountPath: match[1], symbol: match[2] });
  }

  return mounts;
}

function resolveRouteFile(resolvedModuleFile: string, routerSymbol: string): string {
  const content = read(resolvedModuleFile);

  const aliasRegex = new RegExp(
    `export\\s*\\{\\s*default\\s+as\\s+${routerSymbol}\\s*\\}\\s*from\\s*["'](.+?)["'];?`
  );
  const aliasMatch = content.match(aliasRegex);
  if (aliasMatch?.[1]) {
    return resolveModuleFile(path.dirname(resolvedModuleFile), aliasMatch[1]);
  }

  const defaultReExportRegex = /export\s*\{\s*default\s*\}\s*from\s*["'](.+?)["'];?/;
  const defaultMatch = content.match(defaultReExportRegex);
  if (defaultMatch?.[1]) {
    return resolveModuleFile(path.dirname(resolvedModuleFile), defaultMatch[1]);
  }

  return resolvedModuleFile;
}

function extractEndpoints(routeFile: string, mountPath: string, workspaceRoot: string): EndpointRow[] {
  const content = read(routeFile);
  const rows: EndpointRow[] = [];
  const routeRegex = /router\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gms;

  for (const match of content.matchAll(routeRegex)) {
    const method = match[1].toUpperCase() as HttpMethod;
    const routePath = match[2];
    rows.push({
      method,
      path: normalizeFullPath(mountPath, routePath),
      mountPath,
      sourceFile: toPosix(path.relative(workspaceRoot, routeFile)),
    });
  }

  return rows;
}

function buildMarkdown(rows: EndpointRow[]): string {
  const now = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# Endpoint Matrix (Auto-Generated)");
  lines.push("");
  lines.push(`Generated at: ${now}`);
  lines.push("");
  lines.push("Source of truth:");
  lines.push("- Mounted prefixes from src/server.ts");
  lines.push("- Route handlers parsed from src/routes/**/* where router.<method>(\"path\") is used");
  lines.push("");
  lines.push("## Endpoints");
  lines.push("");
  lines.push("| Method | Path | Mount | Source |" );
  lines.push("|--------|------|-------|--------|");

  for (const row of rows) {
    lines.push(`| ${row.method} | ${row.path} | ${row.mountPath} | ${row.sourceFile} |`);
  }

  lines.push("");
  lines.push("## Regeneration");
  lines.push("");
  lines.push("Run one of:");
  lines.push("- pnpm docs:endpoints");
  lines.push("- npx tsx scripts/generate-endpoint-matrix.ts");
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const workspaceRoot = process.cwd();
  const serverFile = path.join(workspaceRoot, "src", "server.ts");

  if (!exists(serverFile)) {
    throw new Error("src/server.ts not found. Run this script from workspace root.");
  }

  const serverContent = read(serverFile);
  const importMap = parseImports(serverContent);
  const mountedRouters = parseMountedRouters(serverContent);

  const resolvedRouters: MountedRouter[] = mountedRouters
    .map((m): MountedRouter | null => {
      const sourcePath = importMap.get(m.symbol);
      if (!sourcePath || !sourcePath.startsWith(".")) {
        return null;
      }

      const resolvedFile = resolveModuleFile(path.dirname(serverFile), sourcePath);
      const routeFile = resolveRouteFile(resolvedFile, m.symbol);

      return {
        mountPath: m.mountPath,
        symbol: m.symbol,
        sourcePath,
        resolvedFile,
        routeFile,
      };
    })
    .filter((r): r is MountedRouter => r !== null);

  const rows: EndpointRow[] = [];
  for (const router of resolvedRouters) {
    rows.push(...extractEndpoints(router.routeFile, router.mountPath, workspaceRoot));
  }

  rows.sort((a, b) => {
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    if (a.method !== b.method) {
      return METHOD_ORDER[a.method] - METHOD_ORDER[b.method];
    }
    return a.sourceFile.localeCompare(b.sourceFile);
  });

  const outFile = path.join(workspaceRoot, "docs", "ENDPOINT_MATRIX.md");
  fs.writeFileSync(outFile, buildMarkdown(rows), "utf8");

  console.log(`Wrote ${rows.length} endpoints to ${toPosix(path.relative(workspaceRoot, outFile))}`);
}

main();
