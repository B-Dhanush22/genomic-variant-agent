const state = {
  phenotypes: [],
  result: null,
  activeTab: "gene",
  progressTimer: null
};

const tabLabels = {
  gene: "Gene Info",
  variant: "Variant",
  protein: "Exon & Domain",
  phenotypes: "OMIM & Phenotypes",
  papers: "Papers",
  exports: "Export"
};

document.addEventListener("DOMContentLoaded", () => {
  drawSystemVisual();
  bindForm();
  bindTabs();
  bindAutocomplete();
  renderRecent();
  checkHealth();
});

function bindForm() {
  const form = document.querySelector("#analysisForm");
  const addButton = document.querySelector("#addPhenotype");
  const phenotypeInput = document.querySelector("#phenotypeInput");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAnalysis();
  });

  addButton.addEventListener("click", () => addPhenotype(phenotypeInput.value));
  phenotypeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addPhenotype(phenotypeInput.value);
    }
  });

  document.querySelector("#clearRecent").addEventListener("click", () => {
    localStorage.removeItem("variant-agent-recent");
    renderRecent();
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
      renderTab();
    });
  });
}

function bindAutocomplete() {
  const geneInput = document.querySelector("#geneInput");
  const phenotypeInput = document.querySelector("#phenotypeInput");
  geneInput.addEventListener("input", debounce(() => loadSuggestions("genes", geneInput.value), 180));
  phenotypeInput.addEventListener("input", debounce(() => loadSuggestions("hpo", phenotypeInput.value), 180));
  loadSuggestions("genes", "");
  loadSuggestions("hpo", "");
}

async function loadSuggestions(type, query) {
  const endpoint = type === "genes" ? "/api/suggest/genes" : "/api/suggest/hpo";
  const list = document.querySelector(type === "genes" ? "#geneOptions" : "#phenotypeOptions");
  try {
    const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    list.innerHTML = (data.suggestions || [])
      .map((item) => {
        const value = type === "genes" ? item.symbol : item.label;
        const label = type === "genes" ? item.name : item.id;
        return `<option value="${escapeHtml(value)}" label="${escapeHtml(label || value)}"></option>`;
      })
      .join("");
  } catch {
    list.innerHTML = "";
  }
}

function addPhenotype(value) {
  const text = value.trim();
  if (!text) return;
  if (!state.phenotypes.some((item) => item.toLowerCase() === text.toLowerCase())) {
    state.phenotypes.push(text);
  }
  document.querySelector("#phenotypeInput").value = "";
  renderPhenotypeChips();
}

function renderPhenotypeChips() {
  const target = document.querySelector("#phenotypeChips");
  target.innerHTML = state.phenotypes
    .map((phenotype, index) => `
      <span class="chip">
        ${escapeHtml(phenotype)}
        <button type="button" aria-label="Remove ${escapeHtml(phenotype)}" data-index="${index}">x</button>
      </span>
    `)
    .join("");
  target.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.phenotypes.splice(Number(button.dataset.index), 1);
      renderPhenotypeChips();
    });
  });
}

async function submitAnalysis() {
  const form = document.querySelector("#analysisForm");
  const payload = formPayload(form);
  hideErrors();
  setLoading(true);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw data;

    state.result = data;
    state.activeTab = "gene";
    saveRecent(payload);
    showResult();
  } catch (error) {
    showErrors(error.details?.length ? error.details : [error.error || "Analysis failed."]);
  } finally {
    setLoading(false);
  }
}

function formPayload(form) {
  const formData = new FormData(form);
  return {
    gender: formData.get("gender"),
    age: formData.get("age"),
    phenotypes: state.phenotypes,
    gene: formData.get("gene"),
    cdna: formData.get("cdna"),
    protein: formData.get("protein"),
    zygosity: formData.get("zygosity"),
    inheritance: formData.getAll("inheritance")
  };
}

function setLoading(isLoading) {
  const loading = document.querySelector("#loadingState");
  const button = document.querySelector("#submitButton");
  const bar = document.querySelector("#progressBar");
  const label = document.querySelector("#loadingLabel");
  const stages = ["Validating query", "Querying public sources", "Searching local corpus", "Ranking papers", "Formatting report"];
  let index = 0;

  button.disabled = isLoading;
  loading.hidden = !isLoading;
  if (!isLoading) {
    clearInterval(state.progressTimer);
    bar.style.width = "15%";
    return;
  }

  label.textContent = stages[index];
  bar.style.width = "18%";
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    label.textContent = stages[index];
    bar.style.width = `${Math.min(92, 18 + index * 18)}%`;
  }, 900);
}

function showResult() {
  document.querySelector("#emptyState").hidden = true;
  document.querySelector("#resultView").hidden = false;
  document.querySelector("#generatedAt").textContent = formatDate(state.result.generatedAt);
  document.querySelector("#resultTitle").textContent = [
    state.result.query.gene || "Phenotype Query",
    state.result.query.cdna,
    state.result.query.protein
  ].filter(Boolean).join(" / ");

  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
  renderSourceStatus();
  renderTab();
}

function renderSourceStatus() {
  const strip = document.querySelector("#sourceStatusStrip");
  strip.innerHTML = state.result.sourceSummary
    .map((source) => `<span class="badge ${escapeAttr(source.status)}" title="${escapeAttr(source.message)}">${escapeHtml(source.name)}: ${escapeHtml(source.status)}</span>`)
    .join("");
}

function renderTab() {
  if (!state.result) return;
  const content = document.querySelector("#tabContent");
  const renderers = {
    gene: renderGeneTab,
    variant: renderVariantTab,
    protein: renderProteinTab,
    phenotypes: renderPhenotypesTab,
    papers: renderPapersTab,
    exports: renderExportTab
  };
  content.innerHTML = renderers[state.activeTab]();
  if (state.activeTab === "protein") drawProteinMap();
}

function renderGeneTab() {
  const { geneInfo, warnings, query } = state.result;
  return `
    ${warnings.length ? `<div class="notice">${warnings.map(escapeHtml).join("<br>")}</div>` : ""}
    <div class="content-grid">
      <section class="info-panel">
        <h3>Gene</h3>
        ${factTable([
          ["Symbol", geneInfo.symbol || "Not provided"],
          ["Input", geneInfo.input || "Not provided"],
          ["Official in local cache", geneInfo.official ? "Yes" : "No"],
          ["Name", geneInfo.name || "Not available"],
          ["Aliases", geneInfo.aliases.join(", ") || "Not available"],
          ["Phenotypes queried", query.phenotypes.map((item) => `${item.label}${item.id ? ` (${item.id})` : ""}`).join(", ") || "Not provided"]
        ])}
      </section>
      <section class="info-panel">
        <h3>Protein</h3>
        ${factTable([
          ["UniProt accession", geneInfo.protein.accession ? link(geneInfo.protein.url, geneInfo.protein.accession) : "Not available"],
          ["Entry", geneInfo.protein.entry || "Not available"],
          ["Protein name", geneInfo.protein.name || "Not available"],
          ["Length", geneInfo.protein.length || "Not available"]
        ])}
      </section>
    </div>
    <section class="info-panel">
      <h3>Source Status</h3>
      ${sourceTable()}
    </section>
  `;
}

function renderVariantTab() {
  const { variant, query } = state.result;
  const clinvarRows = variant.clinvar.matches.length
    ? variant.clinvar.matches.map((item) => `
      <tr>
        <td>${link(item.url, item.accession || item.id)}</td>
        <td>${escapeHtml(item.significance)}</td>
        <td>${escapeHtml(item.reviewStatus)}</td>
        <td>${escapeHtml((item.conditions || []).join(", ") || "Not provided")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">${escapeHtml(variant.clinvar.message)}</td></tr>`;

  return `
    <div class="content-grid">
      <section class="info-panel">
        <h3>Variant Query</h3>
        ${factTable([
          ["cDNA", variant.cdna || "Not provided"],
          ["Protein", variant.protein || "Not provided"],
          ["Zygosity", variant.zygosity || "Not specified"],
          ["Inheritance", variant.inheritance.join(", ") || "Not specified"],
          ["Age", query.age || "Not specified"],
          ["Gender", query.gender || "Not specified"]
        ])}
      </section>
      <section class="info-panel">
        <h3>Clinical Classification</h3>
        ${factTable([
          ["ClinVar status", variant.clinvar.status],
          ["Primary classification", variant.clinvar.primaryClassification || "Not available"],
          ["Message", variant.clinvar.message || "Not available"]
        ])}
      </section>
    </div>
    <section class="info-panel">
      <h3>ClinVar Records</h3>
      <table class="fact-table">
        <thead><tr><th>Record</th><th>Classification</th><th>Review Status</th><th>Conditions</th></tr></thead>
        <tbody>${clinvarRows}</tbody>
      </table>
    </section>
  `;
}

function renderProteinTab() {
  const mapping = state.result.variant.proteinMapping;
  const exon = state.result.variant.exon;
  const domains = mapping.domains || [];
  return `
    <div class="content-grid">
      <section class="info-panel">
        <h3>Exon Location</h3>
        ${factTable([
          ["Exon", exon.exon || "Not available"],
          ["Source", exon.source || "Franklin/GeneBee not configured"],
          ["Message", exon.message || "Not available"]
        ])}
      </section>
      <section class="info-panel">
        <h3>Protein Domain Mapping</h3>
        ${factTable([
          ["Amino acid position", mapping.position || "Not provided"],
          ["Domain matches", domains.length || 0],
          ["Message", mapping.message]
        ])}
      </section>
    </div>
    <canvas id="proteinMap" class="domain-canvas" width="920" height="220" aria-label="Protein domain map"></canvas>
    <section class="info-panel">
      <h3>Domain Details</h3>
      ${domains.length ? factTable(domains.map((domain) => [
        `${domain.source} ${domain.accession || ""}`.trim(),
        `${domain.name} (${domain.begin}-${domain.end})${domain.description ? ` - ${domain.description}` : ""}`
      ])) : `<p>No domain match available for this protein position.</p>`}
    </section>
  `;
}

function renderPhenotypesTab() {
  const omim = state.result.omim;
  const rows = omim.phenotypes.length
    ? omim.phenotypes.map((item) => `
      <tr>
        <td>${escapeHtml(item.phenotype)}</td>
        <td>${escapeHtml(item.mimNumber)}</td>
        <td>${escapeHtml(item.inheritance || "Not provided")}</td>
        <td>${item.matchesQuery ? "Yes" : "No"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">${escapeHtml(omim.message || "No OMIM phenotype records loaded.")}</td></tr>`;

  return `
    <section class="info-panel">
      <h3>OMIM Phenotype-Inheritance Associations</h3>
      <table class="fact-table">
        <thead><tr><th>Phenotype</th><th>OMIM</th><th>Inheritance</th><th>Query Match</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="info-panel">
      <h3>Queried Phenotypes</h3>
      ${factTable(state.result.query.phenotypes.map((item) => [
        item.label,
        `${item.id || "No HPO ID in starter cache"}${item.matched ? "" : " (free text)"}`
      ]))}
    </section>
  `;
}

function renderPapersTab() {
  const { papers, stats } = state.result.literature;
  return `
    <div class="metric-row">
      <div class="metric"><strong>${stats.total}</strong><span>Papers displayed</span></div>
      <div class="metric"><strong>${stats.averageConfidence}%</strong><span>Average confidence</span></div>
      <div class="metric"><strong>${stats.yearRange.length ? stats.yearRange.join("-") : "NA"}</strong><span>Year range</span></div>
      <div class="metric"><strong>${Object.keys(stats.byTier).length}</strong><span>Match tiers</span></div>
    </div>
    ${stats.commonPhenotypes.length ? `<section class="info-panel"><h3>Common Phenotypes</h3>${factTable(stats.commonPhenotypes.map((item) => [item.label, item.count]))}</section>` : ""}
    <section class="paper-list">
      ${papers.length ? papers.map(renderPaperCard).join("") : `<div class="notice">No papers matched this query. Broaden the variant or phenotype terms, or add local text/JSON papers under data/papers.</div>`}
    </section>
  `;
}

function renderPaperCard(paper) {
  return `
    <article class="paper-card">
      <div class="paper-meta">
        <span class="badge ok">${escapeHtml(paper.matchType)}</span>
        <span class="badge neutral">${paper.confidencePercent}% confidence</span>
        ${paper.pmid ? `<span class="badge neutral">PMID ${escapeHtml(paper.pmid)}</span>` : ""}
      </div>
      <h3>${escapeHtml(paper.title)}</h3>
      <p>${escapeHtml([paper.authors, paper.journal, paper.year].filter(Boolean).join(" | "))}</p>
      <p>${escapeHtml(paper.explanation || "Matched by analysis ranking.")}</p>
      <div class="paper-sections">
        <details open>
          <summary>Bibliographic Information</summary>
          ${factTable([
            ["PMID", paper.pmid ? link(`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`, paper.pmid) : "Not available"],
            ["DOI", paper.doi || "Not available"],
            ["Source", paper.source || "Local corpus"],
            ["Study type", paper.studyType || "Not classified"]
          ])}
        </details>
        <details>
          <summary>Variant Information</summary>
          ${factTable([
            ["cDNA positions", (paper.cdnaVariants || []).join(", ") || "Not extracted"],
            ["Protein positions", (paper.proteinVariants || []).join(", ") || "Not extracted"],
            ["Variant types", (paper.variantTypes || []).join(", ") || "Not extracted"],
            ["Total variants", (paper.cdnaVariants || []).length + (paper.proteinVariants || []).length]
          ])}
        </details>
        <details>
          <summary>Phenotypes and Genetics</summary>
          ${factTable([
            ["Phenotypes", (paper.phenotypes || []).join(", ") || "Not extracted"],
            ["Patient phenotype matches", (paper.phenotypeMatches || []).join(", ") || "None"],
            ["Additional phenotypes", (paper.additionalPhenotypes || []).join(", ") || "None"],
            ["Zygosity", (paper.zygosity || []).join(", ") || "Not extracted"],
            ["Inheritance", (paper.inheritance || []).join(", ") || "Not extracted"]
          ])}
        </details>
        <details>
          <summary>Interpretation and Relevance</summary>
          ${factTable([
            ["Clinical significance", paper.clinicalSignificance || "Not extracted"],
            ["Author interpretation", paper.interpretation || "Not extracted"],
            ["Snippet", paper.snippet || "No text snippet available"],
            ["Score breakdown", (paper.scoreBreakdown || []).map((item) => `${item.label}: ${item.points}`).join(", ") || "Not available"]
          ])}
        </details>
      </div>
      <div class="link-row">
        ${paper.url ? `<a class="action-link" href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">Open Source</a>` : ""}
        ${paper.doi ? `<a class="action-link" href="https://doi.org/${escapeAttr(paper.doi)}" target="_blank" rel="noreferrer">Open DOI</a>` : ""}
      </div>
    </article>
  `;
}

function renderExportTab() {
  const id = state.result.id;
  const formats = [
    ["pdf", "PDF Report"],
    ["excel", "Excel"],
    ["json", "JSON"],
    ["bibtex", "BibTeX"],
    ["csv", "CSV"]
  ];
  return `
    <section class="info-panel">
      <h3>Report Downloads</h3>
      <div class="export-grid">
        ${formats.map(([format, label]) => `<a class="export-button" href="/api/export/${id}?format=${format}" download>${label}</a>`).join("")}
        <button class="export-button" type="button" onclick="window.print()">Print</button>
      </div>
    </section>
    <section class="info-panel">
      <h3>Report Metadata</h3>
      ${factTable([
        ["Report ID", id],
        ["Generated", formatDate(state.result.generatedAt)],
        ["Elapsed", `${state.result.elapsedMs} ms`],
        ["Data sources", state.result.sourceSummary.map((source) => `${source.name}: ${source.status}`).join(", ")]
      ])}
    </section>
    <section class="info-panel">
      <h3>Limitations</h3>
      <ul>${state.result.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function factTable(rows) {
  const safeRows = rows.length ? rows : [["Status", "No data available"]];
  return `
    <table class="fact-table">
      <tbody>
        ${safeRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${value && String(value).includes("<a ") ? value : escapeHtml(value)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function sourceTable() {
  return `
    <table class="fact-table">
      <thead><tr><th>Source</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>
        ${state.result.sourceSummary.map((source) => `<tr><td>${escapeHtml(source.name)}</td><td>${escapeHtml(source.status)}</td><td>${escapeHtml(source.message)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function drawProteinMap() {
  const canvas = document.querySelector("#proteinMap");
  if (!canvas || !state.result) return;
  const context = canvas.getContext("2d");
  const mapping = state.result.variant.proteinMapping;
  const length = state.result.geneInfo.protein.length || Math.max(100, mapping.position || 100);
  const domains = mapping.domains || [];
  const width = canvas.width;
  const height = canvas.height;
  const startX = 55;
  const endX = width - 35;
  const axisY = 94;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfcfd";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#9bb0bd";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(startX, axisY);
  context.lineTo(endX, axisY);
  context.stroke();

  const palette = ["#118178", "#226aa8", "#26744f", "#9b6b15"];
  domains.forEach((domain, index) => {
    const x1 = scale(domain.begin || 1, length, startX, endX);
    const x2 = scale(domain.end || domain.begin || 1, length, startX, endX);
    context.fillStyle = palette[index % palette.length];
    context.fillRect(x1, axisY - 22, Math.max(8, x2 - x1), 44);
    context.fillStyle = "#1b2836";
    context.font = "13px system-ui";
    context.fillText(trimText(domain.name || "Domain", 28), x1, axisY + 44);
  });

  if (mapping.position) {
    const markerX = scale(mapping.position, length, startX, endX);
    context.strokeStyle = "#b33a3a";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(markerX, 35);
    context.lineTo(markerX, 155);
    context.stroke();
    context.fillStyle = "#b33a3a";
    context.font = "bold 14px system-ui";
    context.fillText(`p.${mapping.position}`, Math.min(markerX + 6, width - 70), 31);
  }

  context.fillStyle = "#5f6f7d";
  context.font = "12px system-ui";
  context.fillText("1", startX - 4, axisY + 72);
  context.fillText(String(length), endX - 28, axisY + 72);
}

function drawSystemVisual() {
  const canvas = document.querySelector("#systemVisual");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d8e1e8";
  context.lineWidth = 1;
  for (let x = 20; x < canvas.width - 20; x += 28) {
    const y1 = 22 + Math.sin(x / 28) * 12;
    const y2 = 62 - Math.sin(x / 28) * 12;
    context.beginPath();
    context.moveTo(x, y1);
    context.lineTo(x + 16, y2);
    context.stroke();
  }
  context.strokeStyle = "#118178";
  context.lineWidth = 4;
  context.beginPath();
  for (let x = 18; x < canvas.width - 18; x += 8) {
    const y = 42 + Math.sin(x / 28) * 24;
    if (x === 18) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.strokeStyle = "#226aa8";
  context.beginPath();
  for (let x = 18; x < canvas.width - 18; x += 8) {
    const y = 42 - Math.sin(x / 28) * 24;
    if (x === 18) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.fillStyle = "#b33a3a";
  context.beginPath();
  context.arc(250, 42 - Math.sin(250 / 28) * 24, 6, 0, Math.PI * 2);
  context.fill();
}

function scale(value, length, startX, endX) {
  return startX + (Math.max(1, Math.min(length, value)) / length) * (endX - startX);
}

function trimText(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function saveRecent(payload) {
  if (!document.querySelector("#recentConsent").checked) return;
  const recent = getRecent();
  const item = {
    savedAt: new Date().toISOString(),
    payload
  };
  const key = JSON.stringify(payload);
  const filtered = recent.filter((entry) => JSON.stringify(entry.payload) !== key);
  localStorage.setItem("variant-agent-recent", JSON.stringify([item, ...filtered].slice(0, 10)));
  renderRecent();
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem("variant-agent-recent") || "[]");
  } catch {
    return [];
  }
}

function renderRecent() {
  const target = document.querySelector("#recentSearches");
  const recent = getRecent();
  target.innerHTML = recent.length
    ? recent.map((entry, index) => `
      <button class="recent-item" type="button" data-index="${index}">
        <strong>${escapeHtml([entry.payload.gene, entry.payload.cdna, entry.payload.protein].filter(Boolean).join(" / ") || "Phenotype query")}</strong>
        <small>${escapeHtml((entry.payload.phenotypes || []).join(", ") || formatDate(entry.savedAt))}</small>
      </button>
    `).join("")
    : `<p class="muted">No stored searches.</p>`;
  target.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => restoreRecent(recent[Number(button.dataset.index)].payload));
  });
}

function restoreRecent(payload) {
  const form = document.querySelector("#analysisForm");
  form.elements.gender.value = payload.gender || "";
  form.elements.age.value = payload.age || "";
  form.elements.gene.value = payload.gene || "";
  form.elements.cdna.value = payload.cdna || "";
  form.elements.protein.value = payload.protein || "";
  form.elements.zygosity.value = payload.zygosity || "";
  form.querySelectorAll('input[name="inheritance"]').forEach((input) => {
    input.checked = (payload.inheritance || []).includes(input.value);
  });
  state.phenotypes = payload.phenotypes || [];
  renderPhenotypeChips();
}

async function checkHealth() {
  const badge = document.querySelector("#healthBadge");
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    badge.textContent = data.ok ? "Ready" : "Local";
    badge.className = `badge ${data.ok ? "ok" : "neutral"}`;
  } catch {
    badge.textContent = "Offline";
    badge.className = "badge unavailable";
  }
}

function showErrors(errors) {
  const box = document.querySelector("#formErrors");
  box.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");
  box.hidden = false;
}

function hideErrors() {
  const box = document.querySelector("#formErrors");
  box.hidden = true;
  box.innerHTML = "";
}

function link(url, label) {
  if (!url) return escapeHtml(label);
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
