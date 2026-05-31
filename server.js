const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { analyzeVariant, getReport } = require("./server/analysisService");
const { host, port, publicDir } = require("./server/config");
const { exportReport } = require("./server/exports");
const { suggestGenes, suggestPhenotypes } = require("./server/knowledgeBase");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, time: new Date().toISOString() });
    }

    if (request.method === "GET" && url.pathname === "/api/suggest/genes") {
      return sendJson(response, 200, { suggestions: suggestGenes(url.searchParams.get("q") || "") });
    }

    if (request.method === "GET" && url.pathname === "/api/suggest/hpo") {
      return sendJson(response, 200, { suggestions: suggestPhenotypes(url.searchParams.get("q") || "") });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const payload = await readJsonBody(request);
      const result = await analyzeVariant(payload);
      return sendJson(response, 200, result);
    }

    const exportMatch = url.pathname.match(/^\/api\/export\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && exportMatch) {
      const report = getReport(exportMatch[1]);
      if (!report) return sendJson(response, 404, { error: "Report not found or expired. Run the analysis again." });

      const format = (url.searchParams.get("format") || "json").toLowerCase();
      const exported = exportReport(report, format);
      if (!exported) return sendJson(response, 400, { error: "Unsupported export format." });

      response.writeHead(200, {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.fileName}"`,
        "Cache-Control": "no-store"
      });
      return response.end(exported.body);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname, response, request.method === "HEAD");
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(response, status, {
      error: error.message || "Server error.",
      details: error.details || []
    });
  }
});

server.listen(port, host, () => {
  console.log(`Genomic variant analysis app running at http://localhost:${port}`);
});

function serveStatic(pathname, response, headOnly = false) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(publicDir))) {
    return sendJson(response, 403, { error: "Forbidden." });
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) return sendJson(response, 404, { error: "Not found." });
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (!headOnly) response.end(fallbackData);
        else response.end();
      });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    if (!headOnly) response.end(data);
    else response.end();
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON request body."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}
