const { escapeCsv, normalizeText, safeFileName } = require("./utils");

function exportReport(report, format) {
  switch (format) {
    case "json":
      return {
        contentType: "application/json; charset=utf-8",
        fileName: `${baseName(report)}.json`,
        body: Buffer.from(JSON.stringify(report, null, 2), "utf8")
      };
    case "csv":
      return {
        contentType: "text/csv; charset=utf-8",
        fileName: `${baseName(report)}-papers.csv`,
        body: Buffer.from(toCsv(report), "utf8")
      };
    case "bibtex":
      return {
        contentType: "application/x-bibtex; charset=utf-8",
        fileName: `${baseName(report)}.bib`,
        body: Buffer.from(toBibTex(report), "utf8")
      };
    case "excel":
      return {
        contentType: "application/vnd.ms-excel; charset=utf-8",
        fileName: `${baseName(report)}.xls`,
        body: Buffer.from(toExcelHtml(report), "utf8")
      };
    case "pdf":
      return {
        contentType: "application/pdf",
        fileName: `${baseName(report)}.pdf`,
        body: toPdf(report)
      };
    default:
      return null;
  }
}

function baseName(report) {
  const query = [report.query.gene, report.query.cdna, report.query.protein].filter(Boolean).join("-");
  return safeFileName(`variant-analysis-${query || report.id}`);
}

function toCsv(report) {
  const headers = [
    "Match Type",
    "Confidence",
    "PMID",
    "Title",
    "Authors",
    "Year",
    "Journal",
    "DOI",
    "Genes",
    "cDNA Variants",
    "Protein Variants",
    "Phenotypes",
    "Zygosity",
    "Inheritance",
    "Clinical Significance",
    "URL"
  ];
  const rows = report.literature.papers.map((paper) => [
    paper.matchType,
    `${paper.confidencePercent}%`,
    paper.pmid,
    paper.title,
    paper.authors,
    paper.year,
    paper.journal,
    paper.doi,
    (paper.genes || []).join("; "),
    (paper.cdnaVariants || []).join("; "),
    (paper.proteinVariants || []).join("; "),
    (paper.phenotypes || []).join("; "),
    (paper.zygosity || []).join("; "),
    (paper.inheritance || []).join("; "),
    paper.clinicalSignificance,
    paper.url
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

function toBibTex(report) {
  return report.literature.papers
    .filter((paper) => paper.title)
    .map((paper, index) => {
      const key = `${(paper.authors || "paper").split(/\s+/)[0]}${paper.year || "nd"}${index + 1}`.replace(/[^A-Za-z0-9]/g, "");
      return [
        `@article{${key},`,
        `  title = {${bibEscape(paper.title)}},`,
        `  author = {${bibEscape(paper.fullAuthors?.join(" and ") || paper.authors || "")}},`,
        `  journal = {${bibEscape(paper.journal || "")}},`,
        `  year = {${paper.year || ""}},`,
        paper.doi ? `  doi = {${bibEscape(paper.doi)}},` : "",
        paper.pmid ? `  pmid = {${paper.pmid}},` : "",
        `  url = {${paper.url || ""}}`,
        "}"
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function bibEscape(value) {
  return String(value || "").replace(/[{}]/g, "");
}

function toExcelHtml(report) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Variant Analysis</title></head>
<body>
<h1>Variant Analysis</h1>
<table border="1">
<tr><th>Generated</th><td>${html(report.generatedAt)}</td></tr>
<tr><th>Gene</th><td>${html(report.query.gene)}</td></tr>
<tr><th>cDNA</th><td>${html(report.query.cdna)}</td></tr>
<tr><th>Protein</th><td>${html(report.query.protein)}</td></tr>
<tr><th>Phenotypes</th><td>${html(report.query.phenotypes.map((item) => item.label).join("; "))}</td></tr>
</table>
<h2>Papers</h2>
<table border="1">
<tr><th>Match Type</th><th>Confidence</th><th>PMID</th><th>Title</th><th>Year</th><th>Journal</th><th>Phenotypes</th><th>Clinical Significance</th></tr>
${report.literature.papers.map((paper) => `<tr><td>${html(paper.matchType)}</td><td>${paper.confidencePercent}%</td><td>${html(paper.pmid)}</td><td>${html(paper.title)}</td><td>${html(paper.year)}</td><td>${html(paper.journal)}</td><td>${html((paper.phenotypes || []).join("; "))}</td><td>${html(paper.clinicalSignificance)}</td></tr>`).join("")}
</table>
<h2>Source Status</h2>
<table border="1">
<tr><th>Source</th><th>Status</th><th>Message</th></tr>
${report.sourceSummary.map((source) => `<tr><td>${html(source.name)}</td><td>${html(source.status)}</td><td>${html(source.message)}</td></tr>`).join("")}
</table>
</body>
</html>`;
}

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function toPdf(report) {
  const lines = [
    "Genomic Variant Analysis Report",
    `Generated: ${report.generatedAt}`,
    `Gene: ${report.query.gene || "Not provided"}`,
    `cDNA: ${report.query.cdna || "Not provided"}`,
    `Protein: ${report.query.protein || "Not provided"}`,
    `Phenotypes: ${report.query.phenotypes.map((item) => item.label).join(", ") || "Not provided"}`,
    `ClinVar: ${report.variant.clinvar.primaryClassification || report.variant.clinvar.message}`,
    `Papers displayed: ${report.literature.stats.total}`,
    `Average confidence: ${report.literature.stats.averageConfidence}%`,
    "",
    "Top Literature Matches"
  ];

  for (const paper of report.literature.papers.slice(0, 20)) {
    lines.push(`${paper.matchType} (${paper.confidencePercent}%): ${paper.title}`);
    if (paper.pmid) lines.push(`PMID: ${paper.pmid}`);
    if (paper.explanation) lines.push(`Why: ${paper.explanation}`);
    lines.push("");
  }

  lines.push("Limitations");
  for (const item of report.limitations) lines.push(`- ${item}`);

  return createSimplePdf(lines);
}

function createSimplePdf(lines) {
  const wrapped = lines.flatMap((line) => wrapPdfLine(normalizeText(line), 92));
  const pages = chunk(wrapped, 54);
  const objects = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const kids = [];
  pages.forEach((pageLines, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    kids.push(`${pageObjectId} 0 R`);
    const content = [
      "BT",
      "/F1 10 Tf",
      "12 TL",
      "50 780 Td",
      ...pageLines.map((line) => `(${escapePdf(line)}) Tj T*`),
      "ET"
    ].join("\n");
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    const offset = offsets[id] || 0;
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function wrapPdfLine(line, width) {
  if (!line) return [""];
  const clean = line.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
  const words = clean.split(/\s+/);
  const out = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      out.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) out.push(current);
  return out;
}

function escapePdf(value) {
  return String(value || "").replace(/[\\()]/g, "\\$&");
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks.length ? chunks : [["No content"]];
}

module.exports = {
  exportReport
};
