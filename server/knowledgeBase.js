const path = require("node:path");
const { dataDir } = require("./config");
const { normalizeKey, normalizeText, readJsonFile, unique } = require("./utils");

const geneRows = readJsonFile(path.join(dataDir, "gene_aliases.json"), []);
const hpoRows = readJsonFile(path.join(dataDir, "hpo_terms.json"), []);

const aliasToGene = new Map();
const symbolToRow = new Map();

for (const row of geneRows) {
  const symbol = normalizeKey(row.symbol);
  if (!symbol) continue;
  symbolToRow.set(symbol, { ...row, symbol });
  aliasToGene.set(symbol, symbol);
  for (const alias of row.aliases || []) {
    aliasToGene.set(normalizeKey(alias), symbol);
  }
}

function normalizeGene(input) {
  const raw = normalizeText(input);
  if (!raw) {
    return { input: "", symbol: "", official: false, aliases: [], suggestions: [] };
  }

  const key = normalizeKey(raw);
  const symbol = aliasToGene.get(key);
  if (symbol) {
    const row = symbolToRow.get(symbol) || {};
    return {
      input: raw,
      symbol,
      official: key === symbol,
      aliases: row.aliases || [],
      name: row.name || "",
      suggestions: []
    };
  }

  return {
    input: raw,
    symbol: key,
    official: false,
    aliases: [],
    name: "",
    suggestions: suggestGenes(raw, 6)
  };
}

function suggestGenes(query, limit = 10) {
  const q = normalizeKey(query);
  if (!q) return geneRows.slice(0, limit).map(formatGeneSuggestion);

  const scored = [];
  for (const row of geneRows) {
    const symbol = normalizeKey(row.symbol);
    const haystack = [row.symbol, row.name, ...(row.aliases || [])].join(" ").toUpperCase();
    let score = 0;
    if (symbol === q) score = 100;
    else if (symbol.startsWith(q)) score = 90;
    else if ((row.aliases || []).some((alias) => normalizeKey(alias).startsWith(q))) score = 80;
    else if (haystack.includes(q)) score = 60;
    if (score) scored.push({ score, row });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.row.symbol.localeCompare(b.row.symbol))
    .slice(0, limit)
    .map(({ row }) => formatGeneSuggestion(row));
}

function suggestPhenotypes(query, limit = 12) {
  const q = normalizeText(query).toLowerCase();
  if (!q) return hpoRows.slice(0, limit);

  const scored = [];
  for (const row of hpoRows) {
    const label = normalizeText(row.label).toLowerCase();
    const synonyms = (row.synonyms || []).join(" ").toLowerCase();
    let score = 0;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 90;
    else if ((row.synonyms || []).some((synonym) => normalizeText(synonym).toLowerCase().startsWith(q))) score = 80;
    else if (`${label} ${synonyms}`.includes(q)) score = 60;
    if (score) scored.push({ score, row });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.row.label.localeCompare(b.row.label))
    .slice(0, limit)
    .map(({ row }) => row);
}

function mapPhenotypes(values) {
  const mapped = [];
  for (const value of values || []) {
    const raw = normalizeText(value);
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const match = hpoRows.find((row) => {
      return row.label.toLowerCase() === lower || (row.synonyms || []).some((synonym) => synonym.toLowerCase() === lower);
    });
    mapped.push(match ? { input: raw, label: match.label, id: match.id, matched: true } : { input: raw, label: raw, id: "", matched: false });
  }
  return unique(mapped.map((item) => item.label)).map((label) => mapped.find((item) => item.label === label));
}

function formatGeneSuggestion(row) {
  return {
    symbol: row.symbol,
    name: row.name || "",
    aliases: row.aliases || []
  };
}

module.exports = {
  geneRows,
  hpoRows,
  mapPhenotypes,
  normalizeGene,
  suggestGenes,
  suggestPhenotypes
};
