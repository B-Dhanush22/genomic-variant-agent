const fs = require("node:fs");
const path = require("node:path");
const { dataDir, papersDir } = require("./config");
const { normalizeKey, normalizeText, readJsonFile, snippet, unique, walkFiles } = require("./utils");

function searchLocalPapers(query) {
  const papers = loadLocalPapers();
  const terms = buildTerms(query);

  const matches = papers
    .map((paper) => enrichPaper(paper))
    .map((paper) => ({ ...paper, localSearchScore: scorePaperText(paper, query, terms), snippet: snippet(paper.fullText, terms) }))
    .filter((paper) => paper.localSearchScore > 0 || !terms.length)
    .sort((a, b) => b.localSearchScore - a.localSearchScore)
    .slice(0, 100);

  return {
    status: "ok",
    searchedAt: new Date().toISOString(),
    corpusSize: papers.length,
    matches
  };
}

function loadLocalPapers() {
  const samplePath = path.join(dataDir, "local_papers.sample.json");
  const sample = readJsonFile(samplePath, []);
  const extraFiles = walkFiles(papersDir, [".json", ".txt", ".md"]);
  const extras = [];

  for (const filePath of extraFiles) {
    if (path.resolve(filePath) === path.resolve(samplePath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === ".json") {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (Array.isArray(parsed)) extras.push(...parsed);
        else extras.push(parsed);
      } else {
        const fullText = fs.readFileSync(filePath, "utf8");
        extras.push({
          id: `file-${Buffer.from(filePath).toString("hex").slice(0, 16)}`,
          source: "Local text corpus",
          title: path.basename(filePath, ext).replace(/[_-]+/g, " "),
          authors: "",
          year: "",
          journal: "",
          filePath,
          fullText
        });
      }
    } catch {
      // Ignore unreadable corpus files so a single bad paper does not block analysis.
    }
  }

  return [...sample, ...extras].map((paper, index) => ({
    id: paper.id || `local-${index + 1}`,
    source: paper.source || "Local corpus",
    ...paper
  }));
}

function enrichPaper(paper) {
  const fullText = normalizeText([paper.fullText, paper.title, paper.abstract, paper.interpretation].filter(Boolean).join(" "));
  return {
    ...paper,
    fullText,
    genes: unique([...(paper.genes || []), ...extractGenes(fullText)]).map(normalizeKey),
    cdnaVariants: unique([...(paper.cdnaVariants || []), ...extractCdnaVariants(fullText)]),
    proteinVariants: unique([...(paper.proteinVariants || []), ...extractProteinVariants(fullText)]),
    phenotypes: unique([...(paper.phenotypes || []), ...extractPhenotypeHints(fullText)]),
    zygosity: unique([...(paper.zygosity || []), ...extractZygosity(fullText)]),
    inheritance: unique([...(paper.inheritance || []), ...extractInheritance(fullText)]),
    variantTypes: unique(paper.variantTypes || [])
  };
}

function buildTerms(query) {
  return unique([
    query.gene,
    query.cdna,
    query.protein,
    ...query.phenotypes.map((item) => item.label),
    ...query.phenotypes.map((item) => item.input)
  ].filter(Boolean));
}

function scorePaperText(paper, query, terms) {
  const text = `${paper.fullText} ${(paper.genes || []).join(" ")} ${(paper.cdnaVariants || []).join(" ")} ${(paper.proteinVariants || []).join(" ")} ${(paper.phenotypes || []).join(" ")}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const lower = String(term).toLowerCase();
    if (lower && text.includes(lower)) score += lower.startsWith("c.") || lower.startsWith("p.") ? 25 : 10;
  }

  if (query.gene && (paper.genes || []).map(normalizeKey).includes(query.gene)) score += 30;
  if (query.cdna && (paper.cdnaVariants || []).some((variant) => variant.toLowerCase() === query.cdna.toLowerCase())) score += 50;
  if (query.protein && (paper.proteinVariants || []).some((variant) => variant.toLowerCase() === query.protein.toLowerCase())) score += 35;

  return score;
}

function extractGenes(text) {
  const known = ["BRCA1", "BRCA2", "TP53", "DMD", "CFTR", "MECP2", "SCN1A", "TTN", "LDLR", "PAH", "GBA1", "APC", "FGFR3", "FBN1", "HBB"];
  const upper = text.toUpperCase();
  return known.filter((gene) => upper.includes(gene));
}

function extractCdnaVariants(text) {
  return unique((text.match(/\bc\.[A-Za-z0-9_*+\->]+(?:delins[ACGT]+|del[ACGT]*|dup[ACGT]*|ins[ACGT0-9]+|>[ACGT]+)?/gi) || []).map(cleanVariant));
}

function extractProteinVariants(text) {
  return unique((text.match(/\bp\.[A-Za-z*]{1,3}\d+(?:[A-Za-z*]{1,3}|Ter|fs|del|dup|\?)+/gi) || []).map(cleanVariant));
}

function cleanVariant(value) {
  return String(value || "").replace(/[),.;:]+$/g, "");
}

function extractPhenotypeHints(text) {
  const hints = [
    ["breast cancer", "Breast carcinoma"],
    ["breast carcinoma", "Breast carcinoma"],
    ["ovarian cancer", "Ovarian neoplasm"],
    ["ovarian neoplasm", "Ovarian neoplasm"],
    ["seizure", "Seizure"],
    ["developmental delay", "Global developmental delay"],
    ["hypotonia", "Hypotonia"],
    ["cardiomyopathy", "Cardiomyopathy"],
    ["dilated cardiomyopathy", "Dilated cardiomyopathy"],
    ["muscular dystrophy", "Muscular dystrophy"],
    ["muscle atrophy", "Skeletal muscle atrophy"],
    ["respiratory infections", "Recurrent respiratory infections"],
    ["pancreatic insufficiency", "Exocrine pancreatic insufficiency"],
    ["malabsorption", "Malabsorption"],
    ["intellectual disability", "Intellectual disability"]
  ];
  const lower = text.toLowerCase();
  return unique(hints.filter(([needle]) => lower.includes(needle)).map(([, label]) => label));
}

function extractZygosity(text) {
  const lower = text.toLowerCase();
  return [
    lower.includes("compound heterozygous") ? "Compound heterozygous" : "",
    lower.includes("heterozygous") ? "Heterozygous" : "",
    lower.includes("homozygous") ? "Homozygous" : "",
    lower.includes("hemizygous") ? "Hemizygous" : ""
  ].filter(Boolean);
}

function extractInheritance(text) {
  const lower = text.toLowerCase();
  return [
    lower.includes("autosomal dominant") ? "Autosomal Dominant" : "",
    lower.includes("autosomal recessive") ? "Autosomal Recessive" : "",
    lower.includes("x-linked dominant") ? "X-linked Dominant" : "",
    lower.includes("x-linked recessive") ? "X-linked Recessive" : "",
    lower.includes("mitochondrial") ? "Mitochondrial" : "",
    lower.includes("de novo") ? "De novo" : "",
    lower.includes("sporadic") ? "Sporadic" : ""
  ].filter(Boolean);
}

module.exports = {
  loadLocalPapers,
  searchLocalPapers
};
