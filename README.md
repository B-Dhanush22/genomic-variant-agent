# Genomic Variant Analysis Agent

Local MVP implementation of the genomic variant analysis specification in `COMPLETE_SYSTEM_PROMPT.md`.

## What is included

- 8-field clinical query UI: gender, age, phenotypes, gene, cDNA, protein, zygosity, inheritance.
- Gene/HPO autocomplete from starter local caches.
- Backend validation for age, HGVS-like cDNA/protein notation, gene aliases, phenotype chips, and inheritance values.
- Parallel source orchestration for ClinVar, PubMed, UniProt, InterPro, PFAM-derived annotations, OMIM, LitVar, Franklin, GeneBee, and a local literature corpus.
- Public adapters for NCBI EUtils, UniProt, and InterPro.
- Explicit configuration-required statuses for protected or account-specific APIs.
- Local paper search over `data/local_papers.sample.json` and `data/papers/**/*.{json,txt,md}`.
- 6-tier paper ranking: exact variant, nearby variant, amino acid, domain/exon, phenotype, gene-only.
- Six result tabs and downloads for PDF, Excel-compatible `.xls`, JSON, BibTeX, and CSV.

## Run

```powershell
cd "C:\Users\Dhanushkumar\Music\RAG data sets\ChatExport_2026-05-06\genomic-variant-agent"
npm start
```

Open `http://localhost:4173`.

## Run From GitHub

GitHub Pages cannot run this project by itself because the analysis API is a Node backend. The simplest GitHub-native way to run it is GitHub Codespaces.

### Push to a GitHub repository

From this folder:

```powershell
git init
git add .
git commit -m "Initial genomic variant agent"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/genomic-variant-agent.git
git push -u origin main
```

### Run in GitHub Codespaces

1. Open the repository on GitHub.
2. Select `Code` -> `Codespaces` -> `Create codespace on main`.
3. In the Codespaces terminal, run:

```bash
npm start
```

4. Open the forwarded port `4173`.

The repository includes `.devcontainer/devcontainer.json`, so Codespaces will use Node 24 and forward the app port automatically.

### Automatic checks

The GitHub Actions workflow at `.github/workflows/ci.yml` runs:

```bash
npm run check
```

on pushes and pull requests.

### Deploy from the GitHub repository

For a public always-on app, connect this repository to a Node-capable host such as Render, Railway, Fly.io, Azure App Service, or any Docker host.

Use:

- Build command: none required
- Start command: `npm start`
- Port: `4173` or the host-provided `PORT`

The included `Dockerfile` can also run the same app as a container.

## Configure APIs

Copy `.env.example` to `.env` or set environment variables before starting:

```powershell
$env:NCBI_API_KEY = "optional-ncbi-key"
$env:OMIM_API_KEY = "your-omim-key"
$env:FRANKLIN_API_KEY = "your-franklin-key"
$env:GENEBEE_API_KEY = "your-genebee-key"
$env:LITVAR_API_URL = "https://your-litvar-compatible-endpoint"
npm start
```

NCBI keys are optional but improve EUtils rate limits. OMIM, Franklin, GeneBee, and LitVar access depends on the credentials and endpoint agreements for those services.

## Add local papers

Place JSON, TXT, or MD files in `data/papers`.

JSON can be one paper object or an array:

```json
{
  "title": "Example variant paper",
  "pmid": "12345678",
  "year": 2024,
  "genes": ["BRCA1"],
  "cdnaVariants": ["c.68_69delAG"],
  "proteinVariants": ["p.Glu23Valfs"],
  "phenotypes": ["Breast carcinoma"],
  "zygosity": ["Heterozygous"],
  "inheritance": ["Autosomal Dominant"],
  "fullText": "Full extracted paper text here."
}
```

For PDFs, convert the text first with your preferred extractor or OCR pipeline, then save the extracted text or metadata JSON under `data/papers`.

## Smoke test query

Use:

- Gene: `BRCA1`
- cDNA: `c.68_69delAG`
- Protein: `p.Glu23Valfs`
- Phenotype: `Breast cancer`
- Zygosity: `Heterozygous`
- Inheritance: `AD`

The sample corpus should return an exact-variant paper match even without internet access.
