const {
  cacheTtlMs,
  franklinApiKey,
  genebeeApiKey,
  litvarApiUrl,
  ncbiApiKey,
  omimApiKey,
  requestTimeoutMs
} = require("./config");
const { fetchJson, fetchText, normalizeText, sourceResult, unique } = require("./utils");
const { extractProteinCoordinate } = require("./validators");

const cache = new Map();

async function queryAllSources(query) {
  const [clinvar, litvar, omim, uniprot, franklin, genebee, pubmed] = await Promise.all([
    cached(`clinvar:${query.gene}:${query.cdna}`, () => queryClinVar(query)),
    cached(`litvar:${query.gene}:${query.cdna}:${query.protein}`, () => queryLitVar(query)),
    cached(`omim:${query.gene}`, () => queryOmim(query)),
    cached(`uniprot:${query.gene}`, () => queryUniProt(query)),
    cached(`franklin:${query.gene}:${query.cdna}`, () => queryFranklin(query)),
    cached(`genebee:${query.gene}:${query.cdna}`, () => queryGeneBee(query)),
    cached(`pubmed:${query.gene}:${query.cdna}:${query.protein}:${query.phenotypes.map((p) => p.label).join("|")}`, () => queryPubMed(query), 60 * 60 * 1000)
  ]);

  const interpro = await cached(`interpro:${uniprot.data?.accession || ""}`, () => queryInterPro(uniprot));
  const pfam = buildPfamFromInterPro(interpro);
  const proteinMapping = mapProteinPosition(query, uniprot, interpro);
  const exonMapping = chooseExonMapping(franklin, genebee);

  return {
    clinvar,
    litvar,
    omim,
    uniprot,
    interpro,
    pfam,
    franklin,
    genebee,
    pubmed,
    proteinMapping,
    exonMapping
  };
}

async function cached(key, factory, ttlMs = cacheTtlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.createdAt < ttlMs) return hit.value;
  const value = await factory();
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

async function queryClinVar(query) {
  if (!query.gene || !query.cdna) {
    return sourceResult("ClinVar", "skipped", {}, "Provide gene and cDNA position for ClinVar variant lookup.");
  }

  try {
    const term = `${query.gene}[gene] AND "${query.cdna}"`;
    const search = await ncbiJson("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
      db: "clinvar",
      term,
      retmode: "json",
      retmax: 8
    });
    const ids = search.esearchresult?.idlist || [];
    if (!ids.length) return sourceResult("ClinVar", "ok", { matches: [] }, "No ClinVar records found for this exact query.");

    const summary = await ncbiJson("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", {
      db: "clinvar",
      id: ids.join(","),
      retmode: "json"
    });

    const records = ids.map((id) => parseClinVarSummary(id, summary.result?.[id])).filter(Boolean);
    return sourceResult("ClinVar", "ok", { matches: records, query: term }, `${records.length} ClinVar record(s) found.`);
  } catch (error) {
    return sourceResult("ClinVar", "unavailable", {}, readableError(error));
  }
}

async function queryLitVar(query) {
  if (!query.gene || (!query.cdna && !query.protein)) {
    return sourceResult("LitVar", "skipped", {}, "Provide gene plus cDNA or protein position for LitVar lookup.");
  }
  if (!litvarApiUrl) {
    return sourceResult("LitVar", "configuration_required", {}, "Set LITVAR_API_URL if you have a local or institutional LitVar-compatible endpoint.");
  }

  try {
    const data = await fetchJson(litvarApiUrl, {
      gene: query.gene,
      variant: query.cdna || query.protein
    });
    return sourceResult("LitVar", "ok", data, "LitVar-compatible endpoint returned data.");
  } catch (error) {
    return sourceResult("LitVar", "unavailable", {}, readableError(error));
  }
}

async function queryOmim(query) {
  if (!query.gene) return sourceResult("OMIM", "skipped", {}, "Provide a gene name for OMIM lookup.");
  if (!omimApiKey) {
    return sourceResult("OMIM", "configuration_required", {}, "Set OMIM_API_KEY to retrieve OMIM phenotype-inheritance records.");
  }

  try {
    const data = await fetchJson("https://api.omim.org/api/entry/search", {
      search: query.gene,
      include: "geneMap,clinicalSynopsis",
      format: "json",
      apiKey: omimApiKey
    });
    const entries = data.omim?.searchResponse?.entryList || [];
    return sourceResult("OMIM", "ok", { entries: entries.map((item) => item.entry || item) }, `${entries.length} OMIM entr${entries.length === 1 ? "y" : "ies"} found.`);
  } catch (error) {
    return sourceResult("OMIM", "unavailable", {}, readableError(error));
  }
}

async function queryUniProt(query) {
  if (!query.gene) return sourceResult("UniProt", "skipped", {}, "Provide a gene name for UniProt lookup.");

  try {
    const data = await fetchJson("https://rest.uniprot.org/uniprotkb/search", {
      query: `(gene_exact:${query.gene}) AND (organism_id:9606)`,
      fields: "accession,id,protein_name,gene_names,organism_name,length,ft_domain,ft_region,sequence",
      format: "json",
      size: 1
    });
    const record = data.results?.[0];
    if (!record) return sourceResult("UniProt", "ok", {}, "No reviewed human UniProt record found.");

    const parsed = parseUniProtRecord(record);
    return sourceResult("UniProt", "ok", parsed, `UniProt accession ${parsed.accession} loaded.`);
  } catch (error) {
    return sourceResult("UniProt", "unavailable", {}, readableError(error));
  }
}

async function queryInterPro(uniprotResult) {
  const accession = uniprotResult?.data?.accession;
  if (!accession) return sourceResult("InterPro", "skipped", {}, "UniProt accession is required for InterPro lookup.");

  try {
    const data = await fetchJson(`https://www.ebi.ac.uk/interpro/api/entry/interpro/protein/uniprot/${encodeURIComponent(accession)}/`, {
      page_size: 100
    });
    const entries = (data.results || []).map(parseInterProEntry).filter(Boolean);
    return sourceResult("InterPro", "ok", { accession, entries }, `${entries.length} InterPro domain/family entr${entries.length === 1 ? "y" : "ies"} found.`);
  } catch (error) {
    return sourceResult("InterPro", "unavailable", { accession }, readableError(error));
  }
}

function buildPfamFromInterPro(interproResult) {
  const entries = interproResult?.data?.entries || [];
  const pfam = entries
    .filter((entry) => entry.source?.toLowerCase().includes("pfam") || entry.database?.toLowerCase().includes("pfam"))
    .map((entry) => ({
      accession: entry.accession,
      name: entry.name,
      description: entry.description,
      locations: entry.locations
    }));

  if (pfam.length) return sourceResult("PFAM", "ok", { entries: pfam }, `${pfam.length} PFAM-linked entr${pfam.length === 1 ? "y" : "ies"} found through InterPro.`);
  return sourceResult("PFAM", "skipped", {}, "PFAM family annotations are derived from InterPro when available.");
}

async function queryFranklin(query) {
  if (!query.gene || !query.cdna) {
    return sourceResult("Franklin", "skipped", {}, "Provide gene and cDNA position for exon lookup.");
  }
  if (!franklinApiKey) {
    return sourceResult("Franklin", "configuration_required", {}, "Set FRANKLIN_API_KEY to enable Franklin exon and VEP annotations.");
  }

  return sourceResult("Franklin", "configuration_required", {}, "Franklin endpoint URL is account-specific. Add the endpoint in dataSources.js for your account.");
}

async function queryGeneBee(query) {
  if (!query.gene || !query.cdna) {
    return sourceResult("GeneBee", "skipped", {}, "Provide gene and cDNA position for GeneBee exon lookup.");
  }
  if (!genebeeApiKey) {
    return sourceResult("GeneBee", "configuration_required", {}, "Set GENEBEE_API_KEY and endpoint details if your GeneBee access provides an API.");
  }

  return sourceResult("GeneBee", "configuration_required", {}, "GeneBee API access varies by installation. Add the endpoint in dataSources.js for your account.");
}

async function queryPubMed(query) {
  if (!query.gene && !query.phenotypes.length) {
    return sourceResult("PubMed", "skipped", { papers: [] }, "Provide a gene or phenotype for PubMed lookup.");
  }

  try {
    const levels = buildPubMedQueries(query);
    const allIds = [];
    const byLevel = [];

    for (const level of levels) {
      const search = await ncbiJson("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
        db: "pubmed",
        term: level.term,
        retmode: "json",
        retmax: 25,
        sort: "relevance"
      }, 15000);
      const ids = search.esearchresult?.idlist || [];
      byLevel.push({ ...level, ids });
      for (const id of ids) allIds.push(id);
      if (unique(allIds).length >= 50) break;
    }

    const ids = unique(allIds).slice(0, 50);
    if (!ids.length) return sourceResult("PubMed", "ok", { papers: [], byLevel }, "No PubMed papers found.");

    const summary = await ncbiJson("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", {
      db: "pubmed",
      id: ids.join(","),
      retmode: "json"
    }, 15000);
    const papers = ids.map((id) => parsePubMedSummary(id, summary.result?.[id], byLevel)).filter(Boolean);
    return sourceResult("PubMed", "ok", { papers, byLevel }, `${papers.length} PubMed paper(s) found.`);
  } catch (error) {
    return sourceResult("PubMed", "unavailable", { papers: [] }, readableError(error));
  }
}

function buildPubMedQueries(query) {
  const phenotypes = query.phenotypes.map((item) => item.label).filter(Boolean);
  const levels = [];
  if (query.gene && query.cdna) levels.push({ level: 1, label: "Gene + cDNA", term: `${query.gene} ${query.cdna}` });
  if (query.gene && query.protein) levels.push({ level: 2, label: "Gene + protein", term: `${query.gene} ${query.protein}` });
  if (query.gene && phenotypes.length) levels.push({ level: 3, label: "Gene + phenotype", term: `${query.gene} (${phenotypes.join(" OR ")})` });
  if (query.gene) levels.push({ level: 4, label: "Gene", term: query.gene });
  if (!query.gene && phenotypes.length) levels.push({ level: 3, label: "Phenotype", term: phenotypes.join(" OR ") });
  return levels;
}

async function ncbiJson(url, params, timeoutMs = requestTimeoutMs) {
  const withKey = { ...params };
  if (ncbiApiKey) withKey.api_key = ncbiApiKey;
  return fetchJson(url, withKey, { timeoutMs });
}

function parseClinVarSummary(id, row = {}) {
  if (!row) return null;
  const title = row.title || row.variation_name || row.accession || `ClinVar record ${id}`;
  const germline = row.germline_classification || row.clinical_significance || {};
  const significance = normalizeText(germline.description || row.clinical_significance?.description || row.clinical_significance || "");
  const review = normalizeText(germline.review_status || row.review_status || row.clinical_significance?.review_status || "");
  return {
    id,
    accession: row.accession || "",
    title,
    significance: significance || "Not provided",
    reviewStatus: review || "Not provided",
    conditions: unique([...(row.trait_set || []).map((trait) => trait.trait_name), row.trait_name].filter(Boolean)),
    lastEvaluated: germline.last_evaluated || row.last_evaluated || "",
    url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`
  };
}

function parseUniProtRecord(record) {
  const recommendedName = record.proteinDescription?.recommendedName?.fullName?.value || "";
  const features = (record.features || []).map((feature) => ({
    type: feature.type || "",
    description: feature.description || feature.name || "",
    begin: Number(feature.location?.start?.value || feature.begin || 0),
    end: Number(feature.location?.end?.value || feature.end || 0)
  })).filter((feature) => feature.begin || feature.end);

  return {
    accession: record.primaryAccession || "",
    entry: record.uniProtkbId || "",
    proteinName: recommendedName,
    geneNames: (record.genes || []).flatMap((gene) => [gene.geneName?.value, ...(gene.synonyms || []).map((item) => item.value)]).filter(Boolean),
    length: record.sequence?.length || 0,
    sequence: record.sequence?.value || "",
    domains: features.filter((feature) => /domain|region|motif|site/i.test(feature.type || feature.description)),
    url: `https://www.uniprot.org/uniprotkb/${record.primaryAccession || ""}/entry`
  };
}

function parseInterProEntry(row) {
  const metadata = row.metadata || {};
  const entry = row.extra_fields?.entry || row.entry || {};
  const locations = [];
  const proteins = row.proteins || [];
  for (const protein of proteins) {
    for (const location of protein.entry_protein_locations || protein.locations || []) {
      for (const fragment of location.fragments || []) {
        locations.push({ begin: Number(fragment.start || 0), end: Number(fragment.end || 0) });
      }
    }
  }

  return {
    accession: metadata.accession || entry.accession || row.accession || "",
    name: metadata.name || entry.name || row.name || "InterPro entry",
    description: metadata.description || row.description || "",
    type: metadata.type || row.type || "",
    source: metadata.source_database || row.source_database || "",
    database: metadata.source_database || row.database || "",
    locations
  };
}

function parsePubMedSummary(id, row = {}, byLevel = []) {
  if (!row) return null;
  const authors = (row.authors || []).map((author) => author.name).filter(Boolean);
  const level = byLevel.find((item) => (item.ids || []).includes(id));
  return {
    id: `pubmed-${id}`,
    source: "PubMed",
    pmid: id,
    title: row.title || `PubMed record ${id}`,
    authors: authors.length > 1 ? `${authors[0]} et al.` : authors[0] || "",
    fullAuthors: authors,
    year: extractYear(row.pubdate || row.epubdate || ""),
    journal: row.fulljournalname || row.source || "",
    doi: extractDoi(row.articleids || []),
    genes: [],
    cdnaVariants: [],
    proteinVariants: [],
    phenotypes: [],
    zygosity: [],
    inheritance: [],
    clinicalSignificance: "",
    interpretation: "",
    studyType: row.pubtype?.join(", ") || "",
    fullText: `${row.title || ""} ${row.source || ""} ${row.pubdate || ""}`,
    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    queryLevel: level?.level || null,
    queryLabel: level?.label || ""
  };
}

function extractYear(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : "";
}

function extractDoi(articleIds = []) {
  const doi = articleIds.find((item) => item.idtype === "doi");
  return doi?.value || "";
}

function mapProteinPosition(query, uniprot, interpro) {
  const position = extractProteinCoordinate(query.protein);
  if (!position) return { position: null, domains: [], message: "No protein position supplied." };

  const domains = [];
  for (const feature of uniprot.data?.domains || []) {
    if (position >= feature.begin && position <= feature.end) {
      domains.push({
        name: feature.description || feature.type || "UniProt feature",
        begin: feature.begin,
        end: feature.end,
        source: "UniProt"
      });
    }
  }

  for (const entry of interpro.data?.entries || []) {
    for (const location of entry.locations || []) {
      if (position >= location.begin && position <= location.end) {
        domains.push({
          name: entry.name,
          accession: entry.accession,
          begin: location.begin,
          end: location.end,
          source: "InterPro",
          description: entry.description
        });
      }
    }
  }

  return {
    position,
    domains: unique(domains.map((domain) => `${domain.source}:${domain.name}:${domain.begin}-${domain.end}`)).map((key) => domains.find((domain) => `${domain.source}:${domain.name}:${domain.begin}-${domain.end}` === key)),
    message: domains.length ? `${domains.length} domain/feature match(es) at amino acid ${position}.` : `No domain match found at amino acid ${position}.`
  };
}

function chooseExonMapping(franklin, genebee) {
  const source = [franklin, genebee].find((item) => item.status === "ok" && item.data?.exon);
  if (!source) return { exon: "", source: "", message: "No exon mapping available. Configure Franklin or GeneBee credentials for cDNA-to-exon mapping." };
  return { ...source.data, source: source.name, message: `Exon mapping from ${source.name}.` };
}

function readableError(error) {
  if (error?.name === "AbortError") return "Request timeout.";
  return normalizeText(error?.message || "Request failed.");
}

module.exports = {
  buildPubMedQueries,
  queryAllSources
};
