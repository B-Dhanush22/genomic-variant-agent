const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || "0.0.0.0",
  rootDir,
  publicDir: path.join(rootDir, "public"),
  dataDir: path.join(rootDir, "data"),
  papersDir: path.resolve(rootDir, process.env.PAPERS_DIR || "data/papers"),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
  cacheTtlMs: 24 * 60 * 60 * 1000,
  ncbiApiKey: process.env.NCBI_API_KEY || "",
  omimApiKey: process.env.OMIM_API_KEY || "",
  franklinApiKey: process.env.FRANKLIN_API_KEY || "",
  genebeeApiKey: process.env.GENEBEE_API_KEY || "",
  litvarApiUrl: process.env.LITVAR_API_URL || ""
};
