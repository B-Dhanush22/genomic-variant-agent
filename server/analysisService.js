const crypto = require("node:crypto");
const { queryAllSources } = require("./dataSources");
const { searchLocalPapers } = require("./localPapers");
const { rankPapers } = require("./matcher");
const { validatePayload } = require("./validators");

const reportStore = new Map();

async function analyzeVariant(payload) {
  const validation = validatePayload(payload);
  if (!validation.ok) {
    const error = new Error("Validation failed.");
    error.statusCode = 400;
    error.details = validation.errors;
    throw error;
  }

  const query = validation.query;
  const startedAt = Date.now();
  const [sources, localSearch] = await Promise.all([
    queryAllSources(query),
    Promise.resolve(searchLocalPapers(query))
  ]);
  const literature = rankPapers(query, localSearch, sources);

  const result = {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    query,
    warnings: validation.warnings,
    sourceSummary: summarizeSources(sources, localSearch),
    geneInfo: buildGeneInfo(query, sources),
    variant: buildVariantInfo(query, sources),
    omim: buildOmimInfo(sources.omim, query),
    literature,
    exports: ["pdf", "excel", "json", "bibtex", "csv"],
    limitations: [
      "Informational variant interpretation only; not a diagnosis.",
      "Protected sources require configured API keys.",
      "Local PDF search reads JSON, TXT, and MD corpus files. Convert PDFs to text or JSON for indexing in this dependency-free build."
    ]
  };

  reportStore.set(result.id, result);
  return result;
}

function getReport(id) {
  return reportStore.get(id);
}

function summarizeSources(sources, localSearch) {
  return [
    sources.clinvar,
    sources.litvar,
    sources.omim,
    sources.uniprot,
    sources.interpro,
    sources.pfam,
    sources.franklin,
    sources.genebee,
    sources.pubmed,
    {
      name: "Local PDF/Text Corpus",
      status: "ok",
      message: `${localSearch.matches.length} match(es) from ${localSearch.corpusSize} indexed local record(s).`,
      retrievedAt: localSearch.searchedAt,
      data: {
        corpusSize: localSearch.corpusSize,
        matches: localSearch.matches.length
      }
    }
  ].map((source) => ({
    name: source.name,
    status: source.status,
    message: source.message,
    retrievedAt: source.retrievedAt
  }));
}

function buildGeneInfo(query, sources) {
  const uniprot = sources.uniprot.data || {};
  return {
    symbol: query.gene,
    input: query.geneInput,
    official: query.geneOfficial,
    name: query.geneName || uniprot.proteinName || "",
    aliases: query.geneAliases,
    suggestions: query.geneSuggestions,
    protein: {
      accession: uniprot.accession || "",
      entry: uniprot.entry || "",
      name: uniprot.proteinName || "",
      length: uniprot.length || 0,
      url: uniprot.url || ""
    }
  };
}

function buildVariantInfo(query, sources) {
  const clinvarMatches = sources.clinvar.data?.matches || [];
  return {
    cdna: query.cdna,
    protein: query.protein,
    zygosity: query.zygosity,
    inheritance: query.inheritance,
    clinvar: {
      status: sources.clinvar.status,
      message: sources.clinvar.message,
      matches: clinvarMatches,
      primaryClassification: clinvarMatches[0]?.significance || ""
    },
    exon: sources.exonMapping,
    proteinMapping: sources.proteinMapping
  };
}

function buildOmimInfo(omim, query) {
  const entries = omim.data?.entries || [];
  const phenotypes = [];
  for (const entry of entries) {
    const geneMap = entry.geneMap || {};
    const phenotypeMapList = geneMap.phenotypeMapList || [];
    for (const item of phenotypeMapList) {
      const map = item.phenotypeMap || item;
      phenotypes.push({
        phenotype: map.phenotype || map.phenotypeMimNumber || "OMIM phenotype",
        mimNumber: map.phenotypeMimNumber || "",
        inheritance: map.phenotypeInheritance || "",
        mappingKey: map.phenotypeMappingKey || "",
        matchesQuery: query.phenotypes.some((phenotype) => String(map.phenotype || "").toLowerCase().includes(phenotype.label.toLowerCase()))
      });
    }
  }

  return {
    status: omim.status,
    message: omim.message,
    phenotypes
  };
}

module.exports = {
  analyzeVariant,
  getReport
};
