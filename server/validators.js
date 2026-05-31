const { mapPhenotypes, normalizeGene } = require("./knowledgeBase");
const { normalizeText, stripUnsafeText, toArray, unique } = require("./utils");

const CDNA_PATTERN = /^c\.(?:-?\*?\d+(?:[+-]\d+)?(?:_\*?-?\d+(?:[+-]\d+)?)?)(?:[ACGT]+>[ACGT]+|del[ACGT]*|dup[ACGT]*|ins[ACGT0-9]+|delins[ACGT]+)?$/i;
const PROTEIN_PATTERN = /^p\.(?:\?|[A-Za-z*?0-9_=+\-()]+)$/;

function validatePayload(payload = {}) {
  const errors = [];
  const warnings = [];

  const phenotypes = normalizePhenotypes(payload.phenotypes);
  const mappedPhenotypes = mapPhenotypes(phenotypes);
  const geneInfo = normalizeGene(payload.gene || payload.geneName || "");
  const cdna = normalizeHgvs(payload.cdna || payload.cdnaPosition || "", "c.");
  const protein = normalizeHgvs(payload.protein || payload.proteinPosition || "", "p.");
  const age = normalizeText(payload.age);

  if (!geneInfo.symbol && !mappedPhenotypes.length) {
    errors.push("Enter at least a gene name or one phenotype to start an analysis.");
  }

  if (geneInfo.input && !geneInfo.official && geneInfo.suggestions.length) {
    warnings.push(`Gene "${geneInfo.input}" is not in the local HGNC sample cache. The query will use "${geneInfo.symbol}" and show suggestions.`);
  }

  const ageValidation = validateAge(age);
  if (!ageValidation.valid) errors.push(ageValidation.message);

  if (cdna && !CDNA_PATTERN.test(cdna)) {
    errors.push("cDNA position must follow a recognizable HGVS c. format, such as c.123A>G or c.123_124delAT.");
  }

  if (protein && !PROTEIN_PATTERN.test(protein)) {
    errors.push("Protein position must follow a recognizable HGVS p. format, such as p.R41Q or p.Arg41Gln.");
  }

  const query = {
    gender: normalizeOption(payload.gender, ["Male", "Female", "Other", "Unknown"]),
    age,
    ageRange: ageValidation.range,
    phenotypes: mappedPhenotypes,
    gene: geneInfo.symbol,
    geneInput: geneInfo.input,
    geneOfficial: geneInfo.official,
    geneName: geneInfo.name || "",
    geneAliases: geneInfo.aliases || [],
    geneSuggestions: geneInfo.suggestions || [],
    cdna,
    protein,
    zygosity: normalizeOption(payload.zygosity, ["Homozygous", "Heterozygous", "Hemizygous", "Compound heterozygous", "Unknown"]),
    inheritance: normalizeInheritance(payload.inheritance)
  };

  return { ok: errors.length === 0, errors, warnings, query };
}

function normalizeOption(value, allowed) {
  const text = normalizeText(value);
  if (!text) return "";
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) || "";
}

function normalizeInheritance(value) {
  const aliases = new Map([
    ["AD", "Autosomal Dominant"],
    ["AUTOSOMAL DOMINANT", "Autosomal Dominant"],
    ["AR", "Autosomal Recessive"],
    ["AUTOSOMAL RECESSIVE", "Autosomal Recessive"],
    ["XD", "X-linked Dominant"],
    ["X-LINKED DOMINANT", "X-linked Dominant"],
    ["XR", "X-linked Recessive"],
    ["X-LINKED RECESSIVE", "X-linked Recessive"],
    ["MITOCHONDRIAL", "Mitochondrial"],
    ["DE NOVO", "De novo"],
    ["UNKNOWN", "Unknown"]
  ]);

  return unique(toArray(value).map((item) => aliases.get(normalizeText(item).toUpperCase())).filter(Boolean));
}

function normalizePhenotypes(value) {
  if (Array.isArray(value)) {
    return unique(value.map(stripUnsafeText).filter(Boolean));
  }
  return unique(
    String(value || "")
      .split(/[,;|]/)
      .map(stripUnsafeText)
      .filter(Boolean)
  );
}

function normalizeHgvs(value, prefix) {
  const text = normalizeText(value).replace(/\s/g, "");
  if (!text) return "";
  if (text.toLowerCase().startsWith(prefix)) return text;
  return `${prefix}${text}`;
}

function validateAge(value) {
  if (!value) return { valid: true, range: null };
  const single = value.match(/^(\d{1,3})$/);
  const range = value.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);

  if (single) {
    const age = Number(single[1]);
    if (age > 0 && age <= 150) return { valid: true, range: [age, age] };
  }

  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start > 0 && end <= 150 && start <= end) return { valid: true, range: [start, end] };
  }

  return { valid: false, range: null, message: "Age must be a positive integer up to 150, or a range such as 18-35." };
}

function extractCdnaCoordinate(value) {
  const text = normalizeText(value);
  const numbers = [...text.matchAll(/-?\d+/g)].map((match) => Number(match[0]));
  return numbers.length ? numbers[0] : null;
}

function extractProteinCoordinate(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:[A-Z][a-z]{2}|[A-Z*])(\d+)/);
  return match ? Number(match[1]) : null;
}

module.exports = {
  CDNA_PATTERN,
  PROTEIN_PATTERN,
  extractCdnaCoordinate,
  extractProteinCoordinate,
  validatePayload
};
