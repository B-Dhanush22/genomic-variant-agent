const fs = require("node:fs");
const path = require("node:path");
const { requestTimeoutMs } = require("./config");

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return normalizeText(value).toUpperCase();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function stripUnsafeText(value) {
  return normalizeText(value).replace(/[<>]/g, "");
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function walkFiles(dir, extensions = []) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const stack = [dir];
  const allowed = extensions.map((ext) => ext.toLowerCase());

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (!allowed.length || allowed.includes(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchJson(baseUrl, params = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || requestTimeoutMs);
  const url = buildUrl(baseUrl, params);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "genomic-variant-agent/0.1"
      },
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(baseUrl, params = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || requestTimeoutMs);
  const url = buildUrl(baseUrl, params);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: options.accept || "text/plain, application/xml, */*",
        "User-Agent": "genomic-variant-agent/0.1"
      },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function sourceResult(name, status, data = {}, message = "") {
  return {
    name,
    status,
    message,
    retrievedAt: new Date().toISOString(),
    data
  };
}

function snippet(text, terms = [], radius = 160) {
  const source = normalizeText(text);
  if (!source) return "";
  const lower = source.toLowerCase();
  const found = terms.find((term) => term && lower.includes(String(term).toLowerCase()));
  if (!found) return source.slice(0, radius * 2);
  const index = lower.indexOf(String(found).toLowerCase());
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + String(found).length + radius);
  return `${start > 0 ? "... " : ""}${source.slice(start, end)}${end < source.length ? " ..." : ""}`;
}

function safeFileName(value) {
  return String(value || "variant-analysis")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "variant-analysis";
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

module.exports = {
  buildUrl,
  escapeCsv,
  fetchJson,
  fetchText,
  normalizeKey,
  normalizeText,
  readJsonFile,
  safeFileName,
  snippet,
  sourceResult,
  stripUnsafeText,
  toArray,
  unique,
  walkFiles
};
