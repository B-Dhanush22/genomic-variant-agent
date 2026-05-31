const { extractCdnaCoordinate, extractProteinCoordinate } = require("./validators");
const { normalizeKey, normalizeText, unique } = require("./utils");

const TIERS = [
  { tier: 1, type: "Exact Variant", score: 1.0 },
  { tier: 2, type: "Nearby Variant", score: 0.95 },
  { tier: 3, type: "Amino Acid Change", score: 0.85 },
  { tier: 4, type: "Domain/Exon", score: 0.75 },
  { tier: 5, type: "Phenotype Match", score: 0.65 },
  { tier: 6, type: "Gene Only", score: 0.4 }
];

function rankPapers(query, localSearch, sourceResults) {
  const pubmedPapers = sourceResults.pubmed?.data?.papers || [];
  const sourceContext = {
    exon: sourceResults.exonMapping?.exon || "",
    domains: sourceResults.proteinMapping?.domains || []
  };

  const allPapers = dedupePapers([...(localSearch.matches || []), ...pubmedPapers]);
  const ranked = allPapers
    .map((paper) => classifyPaper(query, normalizePaper(paper), sourceContext))
    .filter((paper) => paper.matchType)
    .sort((a, b) => b.confidence - a.confidence || b.localSearchScore - a.localSearchScore || Number(b.year || 0) - Number(a.year || 0));

  return {
    papers: ranked,
    stats: buildStats(ranked),
    sourceContext
  };
}

function normalizePaper(paper) {
  return {
    id: paper.id || paper.pmid || paper.title,
    source: paper.source || "",
    pmid: paper.pmid || "",
    doi: paper.doi || "",
    title: paper.title || "Untitled paper",
    authors: paper.authors || "",
    fullAuthors: paper.fullAuthors || [],
    year: paper.year || "",
    journal: paper.journal || "",
    genes: unique((paper.genes || []).map(normalizeKey)),
    cdnaVariants: unique(paper.cdnaVariants || []),
    proteinVariants: unique(paper.proteinVariants || []),
    variantTypes: unique(paper.variantTypes || []),
    phenotypes: unique(paper.phenotypes || []),
    zygosity: unique(paper.zygosity || []),
    inheritance: unique(paper.inheritance || []),
    exon: paper.exon || "",
    domains: unique(paper.domains || []),
    clinicalSignificance: paper.clinicalSignificance || "",
    interpretation: paper.interpretation || "",
    studyType: paper.studyType || "",
    fullText: paper.fullText || "",
    snippet: paper.snippet || "",
    localSearchScore: paper.localSearchScore || 0,
    url: paper.url || (paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : ""),
    queryLevel: paper.queryLevel || null,
    queryLabel: paper.queryLabel || ""
  };
}

function classifyPaper(query, paper, sourceContext) {
  const sameGene = isSameGene(query, paper);
  const explanations = [];
  const scoreBreakdown = [];
  const phenotypeMatches = matchPhenotypes(query, paper);
  const inheritanceMatches = matchList(query.inheritance, paper.inheritance);
  const zygosityMatch = query.zygosity && paper.zygosity.some((item) => item.toLowerCase() === query.zygosity.toLowerCase());
  const cdnaExact = query.cdna && paper.cdnaVariants.some((variant) => normalizeText(variant).toLowerCase() === query.cdna.toLowerCase());
  const cdnaNearby = getNearbyCdna(query.cdna, paper.cdnaVariants);
  const proteinSame = getSameProteinPosition(query.protein, paper.proteinVariants);
  const domainExon = getDomainExonMatch(paper, sourceContext);

  let tier = null;

  if (sameGene && cdnaExact) {
    tier = TIERS[0];
    explanations.push(`Exact cDNA variant ${query.cdna} appears in this paper.`);
    scoreBreakdown.push({ label: "Exact variant", points: 50 });
  } else if (sameGene && cdnaNearby) {
    tier = TIERS[1];
    explanations.push(`${cdnaNearby.variant} is within ${cdnaNearby.distance} bp of ${query.cdna}.`);
    scoreBreakdown.push({ label: "Nearby cDNA variant", points: 45 });
  } else if (sameGene && proteinSame) {
    tier = TIERS[2];
    explanations.push(`${proteinSame.variant} affects amino acid ${proteinSame.position}.`);
    scoreBreakdown.push({ label: "Same amino acid", points: 40 });
  } else if (sameGene && domainExon.matched) {
    tier = TIERS[3];
    explanations.push(domainExon.explanation);
    scoreBreakdown.push({ label: "Domain/exon context", points: 35 });
  } else if (sameGene && phenotypeMatches.length) {
    tier = TIERS[4];
    explanations.push(`Phenotype overlap: ${phenotypeMatches.join(", ")}.`);
    scoreBreakdown.push({ label: "Phenotype overlap", points: 30 });
  } else if (sameGene || paper.queryLevel === 4 || (!query.gene && phenotypeMatches.length)) {
    tier = TIERS[5];
    explanations.push(sameGene ? `Paper discusses ${query.gene}.` : "Paper was retrieved by phenotype-level search.");
    scoreBreakdown.push({ label: "Gene or broad query", points: 20 });
  }

  if (!tier) return { ...paper, matchType: "", confidence: 0 };

  if (phenotypeMatches.length) scoreBreakdown.push({ label: "Phenotype detail", points: Math.min(30, phenotypeMatches.length * 10) });
  if (inheritanceMatches.length) scoreBreakdown.push({ label: "Inheritance match", points: 15 });
  if (zygosityMatch) scoreBreakdown.push({ label: "Zygosity match", points: 10 });

  const confidence = Math.min(1, tier.score + phenotypeMatches.length * 0.02 + inheritanceMatches.length * 0.015 + (zygosityMatch ? 0.01 : 0));

  return {
    ...paper,
    tier: tier.tier,
    matchType: tier.type,
    confidence,
    confidencePercent: Math.round(confidence * 100),
    explanation: explanations.join(" "),
    phenotypeMatches,
    inheritanceMatches,
    zygosityMatch,
    scoreBreakdown,
    additionalPhenotypes: paper.phenotypes.filter((phenotype) => !phenotypeMatches.some((match) => match.toLowerCase() === phenotype.toLowerCase()))
  };
}

function isSameGene(query, paper) {
  if (!query.gene) return false;
  return paper.genes.includes(query.gene) || normalizeText(paper.fullText).toUpperCase().includes(query.gene);
}

function getNearbyCdna(userCdna, variants) {
  const userPosition = extractCdnaCoordinate(userCdna);
  if (!userPosition) return null;

  for (const variant of variants || []) {
    const position = extractCdnaCoordinate(variant);
    if (!position) continue;
    const distance = Math.abs(userPosition - position);
    if (distance > 0 && distance <= 10) return { variant, position, distance };
  }

  return null;
}

function getSameProteinPosition(userProtein, variants) {
  const userPosition = extractProteinCoordinate(userProtein);
  if (!userPosition) return null;

  for (const variant of variants || []) {
    const position = extractProteinCoordinate(variant);
    if (position && position === userPosition) return { variant, position };
  }

  return null;
}

function getDomainExonMatch(paper, sourceContext) {
  const exon = normalizeText(sourceContext.exon);
  const paperExon = normalizeText(paper.exon);
  const domainNames = (sourceContext.domains || []).map((domain) => normalizeText(domain.name).toLowerCase()).filter(Boolean);
  const paperDomains = (paper.domains || []).map((domain) => normalizeText(domain).toLowerCase());

  const exonMatch = exon && paperExon && exon === paperExon;
  const domainMatch = domainNames.length && paperDomains.some((paperDomain) => domainNames.some((domain) => paperDomain.includes(domain) || domain.includes(paperDomain)));

  if (exonMatch && domainMatch) return { matched: true, explanation: `Same exon ${exon} and overlapping protein domain are represented.` };
  if (exonMatch) return { matched: true, explanation: `Same exon ${exon} is represented.` };
  if (domainMatch) return { matched: true, explanation: "Overlapping protein domain is represented." };
  return { matched: false, explanation: "" };
}

function matchPhenotypes(query, paper) {
  const wanted = query.phenotypes.map((item) => item.label.toLowerCase());
  if (!wanted.length) return [];
  const paperPhenotypes = paper.phenotypes.map((phenotype) => phenotype.toLowerCase());
  const matches = [];

  for (const item of wanted) {
    const match = paperPhenotypes.find((phenotype) => phenotype === item || phenotype.includes(item) || item.includes(phenotype));
    if (match) matches.push(paper.phenotypes[paperPhenotypes.indexOf(match)]);
  }

  return unique(matches);
}

function matchList(wanted, found) {
  const foundLower = (found || []).map((item) => item.toLowerCase());
  return (wanted || []).filter((item) => foundLower.includes(item.toLowerCase()));
}

function dedupePapers(papers) {
  const seen = new Set();
  const out = [];
  for (const paper of papers) {
    const key = paper.pmid ? `pmid:${paper.pmid}` : `title:${normalizeText(paper.title).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(paper);
  }
  return out;
}

function buildStats(papers) {
  const byTier = {};
  const phenotypes = new Map();
  const years = papers.map((paper) => Number(paper.year)).filter(Boolean);
  for (const paper of papers) {
    byTier[paper.matchType] = (byTier[paper.matchType] || 0) + 1;
    for (const phenotype of paper.phenotypes || []) {
      phenotypes.set(phenotype, (phenotypes.get(phenotype) || 0) + 1);
    }
  }

  return {
    total: papers.length,
    averageConfidence: papers.length ? Math.round((papers.reduce((sum, paper) => sum + paper.confidence, 0) / papers.length) * 1000) / 10 : 0,
    byTier,
    yearRange: years.length ? [Math.min(...years), Math.max(...years)] : [],
    commonPhenotypes: [...phenotypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label, count }))
  };
}

module.exports = {
  rankPapers
};
