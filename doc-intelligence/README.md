# Generic Document Intelligence Engine

A modular, domain-agnostic document processing and structured information extraction engine built in Python 3.11+.

The engine operates independently of specific document domains (e.g., technical reports, financial statements, geological surveys, research papers) and enables caller-defined extraction objectives and schemas supplied dynamically at runtime.

---

## Architecture Overview

The engine follows a 7-stage decoupled pipeline:

```
[ Stage 1: Document Ingestion ]
            │
            ▼
[ Stage 2: Interchangeable Parsing Adapters ]
   ├── PyMuPDF (Fast, local text & layout inspection)
   ├── Docling (Local structured layout, tables & OCR)
   └── LlamaParse (Cloud parser for complex multi-column layouts)
            │
            ▼
   Normalized ParsedDocument (Pages, ContentBlocks, Tables, Images, BoundingBoxes)
            │
            ▼
[ Stage 3: Document Indexing ]
   Compact structural summary: sections, tables, figures, vocabulary, quality indicators
            │
            ├────────────── No Task? ──► [ Output: Parsed & Indexed JSON ]
            │
            ▼ (Task Specification Provided)
[ Stage 4: Task-Driven Relevance Filtering ]
   Retrieves only candidate pages matching task objectives & target fields
            │
            ▼
[ Stage 5: Cost-Aware AI Extraction ]
   Extracts targeted information via provider abstraction (OpenAI, Gemini, Mock)
   Enforces token, call, and retry budgets
            │
            ▼
[ Stage 6: Evidence Grounding & Verification ]
   Cross-references findings against verbatim page text, bboxes, and folios
   Categorizes into: VERIFIED, EXTRACTED, AMBIGUOUS, MISSING
            │
            ▼
[ Stage 7: Structured JSON Artifacts & Execution Trace ]
   Reproducible JSON output with complete provenance and step-by-step audit logs
```

---

## Features

- **Completely Domain-Agnostic**: Zero hardcoded domain schemas or domain-specific extraction rules.
- **Three Interchangeable Parsers**:
  - `pymupdf`: Baseline engine, fast local execution without API keys.
  - `docling`: Rich structured document analysis, headings, and table parsing.
  - `llamaparse`: Optional cloud-based layout parsing for challenging documents.
- **Lightweight Document Indexing**: Compact structural representation that avoids sending entire multi-page documents to LLMs.
- **Provider-Independent Model Interface**:
  - `OpenAICompatibleProvider`: Supports OpenAI, Groq, Mistral, Ollama, vLLM, OpenRouter.
  - `GeminiProvider`: Direct native Google Gemini API support.
  - `MockModelProvider`: Deterministic offline execution and testing without API credentials.
- **Strict Evidence & Provenance Grounding**:
  - Distinguishes between `VERIFIED`, `EXTRACTED`, `AMBIGUOUS`, and `MISSING`.
  - Flags hallucinations or claims that cannot be grounded on the reported page.
  - Retains document hash, page numbers, printed folios, and bounding boxes.
- **Execution Traceability**: Detailed operational audit log recording model calls, token consumption, and decisions.

---

## Installation

Using [`uv`](https://docs.astral.sh/uv/) (recommended):

```bash
cd doc-intelligence
uv sync
```

Or using standard `pip`:

```bash
cd doc-intelligence
pip install -e .
```

---

## Configuration & Environment Variables

Configure external API keys via `.env` or environment variables:

```bash
# Model Providers
OPENAI_API_KEY="sk-..."                 # If using OpenAI models
OPENAI_BASE_URL="https://api.openai.com/v1" # Or custom endpoint (e.g. Ollama, Groq)
GEMINI_API_KEY="AIza..."                # If using Google Gemini

# Parsers
LLAMA_CLOUD_API_KEY="llx-..."           # Only required if using --parser llamaparse
```

*Note: Baseline parsing with `pymupdf` and `docling`, and mocked intelligence workflows run with zero API credentials.*

---

## CLI Usage

The package provides the `doc-intel` command-line tool with two operations:

### 1. Parse Mode (No AI required)
Parses a document into normalized JSON containing blocks, tables, images, metadata, and structural index:

```bash
doc-intel parse path/to/document.pdf --parser pymupdf -o output_parsed.json
```

Options:
- `-p, --parser`: `pymupdf` (default), `docling`, or `llamaparse`.
- `-o, --output`: Destination path for parsed JSON artifact.
- `--extract-tables / --no-tables`: Enable or disable table parsing.
- `--ocr / --no-ocr`: Enable optical character recognition if supported.
- `--max-pages`: Restrict number of pages to parse.

### 2. Intelligence Mode (Task-Driven Extraction)
Accepts a document and a task specification, investigates relevant sections, and outputs verified findings with evidence references:

```bash
doc-intel intelligence path/to/document.pdf \
  --task path/to/task.json \
  --parser pymupdf \
  --provider mock \
  -o output_intelligence.json
```

Using external AI models (e.g., OpenAI or Gemini):

```bash
doc-intel intelligence path/to/document.pdf \
  --task path/to/task.json \
  --provider openai \
  --model gpt-4o-mini \
  -o output_intelligence.json
```

---

## Task Specification Format

A caller supplies an extraction objective and schema as a JSON file:

```json
{
  "task_id": "operational_efficiency_extraction",
  "objective": "Extract recorded operational observations, facility measurements, and dates",
  "instructions": "Only extract observations explicitly reported in the text. Preserve exact numerical units.",
  "fields": [
    "observation_id",
    "facility_or_location",
    "metric_description",
    "measurement_value",
    "observation_date"
  ],
  "output_schema": {
    "type": "object",
    "properties": {
      "observation_id": {"type": "string"},
      "facility_or_location": {"type": "string"},
      "metric_description": {"type": "string"},
      "measurement_value": {"type": "string"},
      "observation_date": {"type": "string"}
    }
  },
  "max_relevant_pages": 3,
  "allow_escalation": true
}
```

---

## Output Artifact Structure

The intelligence stage generates a standardized JSON output:

```json
{
  "task_id": "operational_efficiency_extraction",
  "document_metadata": {
    "document_id": "doc_a67f7fd7c1ae2f6e",
    "filename": "sample_report.pdf",
    "file_hash_sha256": "...",
    "page_count": 2
  },
  "document_index": {
    "sections": [...],
    "tables": [...],
    "page_summaries": [...],
    "quality_indicators": [...]
  },
  "findings": [
    {
      "finding_id": "finding_1",
      "fields": {
        "facility_or_location": {
          "field_name": "facility_or_location",
          "value": "Facility North",
          "status": "verified",
          "confidence": 0.95,
          "evidence": {
            "document_id": "doc_a67f7fd7c1ae2f6e",
            "page_number": 1,
            "printed_page_number": null,
            "section_title": "1. Executive Summary",
            "source_text": "Facility North recorded a baseline energy consumption of 412 MWh",
            "bbox": {"x0": 50.0, "y0": 180.0, "x1": 520.0, "y1": 195.0},
            "extraction_method": "ai_model",
            "model_name": "gpt-4o-mini"
          }
        }
      },
      "is_ambiguous": false,
      "review_required": false
    }
  ],
  "execution_trace": [
    {
      "step_id": "step_1",
      "stage": "Stage 3: Indexing",
      "action": "Build Document Structural Index",
      "duration_seconds": 0.0002,
      "success": true
    },
    {
      "step_id": "step_2",
      "stage": "Stage 4: Task-driven relevance filtering",
      "action": "Query Document Index for candidate pages",
      "details": {"candidate_pages": [1, 2]},
      "duration_seconds": 0.0001,
      "success": true
    }
  ],
  "total_tokens_used": 200,
  "total_model_calls": 1,
  "status": "completed"
}
```

---

## Running Automated Tests

Run the full test suite with:

```bash
uv run pytest -v
```
