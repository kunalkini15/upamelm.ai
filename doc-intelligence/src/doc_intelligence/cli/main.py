from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional
import click
from dotenv import find_dotenv, load_dotenv

# Search and load .env automatically from workspace or current directory
_env_path = find_dotenv(usecwd=True)
if _env_path:
    load_dotenv(_env_path)
else:
    for candidate in [Path.cwd() / ".env", Path.cwd() / "doc-intelligence" / ".env"]:
        if candidate.exists():
            load_dotenv(candidate)
            break

from doc_intelligence.cli.writer import ArtifactWriter
from doc_intelligence.indexing.indexer import DocumentIndexer
from doc_intelligence.parsers.base import ParserOptions
from doc_intelligence.parsers.registry import ParserRegistry
from doc_intelligence.pipeline.extractor import IntelligencePipeline
from doc_intelligence.providers.factory import ProviderFactory
from doc_intelligence.tasks.loader import TaskLoader


@click.group()
def main():
    """Generic Document Intelligence Engine CLI."""
    pass


@main.command("parse")
@click.argument("document_path", type=click.Path(exists=True, dir_okay=False))
@click.option(
    "--parser",
    "-p",
    default="pymupdf",
    type=click.Choice(["pymupdf", "docling", "llamaparse"], case_sensitive=False),
    help="Parsing engine adapter to use (default: pymupdf).",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(dir_okay=False),
    default=None,
    help="Destination path for parsed JSON artifact.",
)
@click.option("--extract-tables/--no-tables", default=True, help="Extract tables if supported.")
@click.option("--ocr/--no-ocr", default=False, help="Enable OCR in parser if supported.")
@click.option("--max-pages", type=int, default=None, help="Maximum number of pages to parse.")
def parse_cmd(
    document_path: str,
    parser: str,
    output: Optional[str],
    extract_tables: bool,
    ocr: bool,
    max_pages: Optional[int],
):
    """Stage 1 & 2: Parse a document into normalized JSON format without requiring AI models."""
    doc_file = Path(document_path).resolve()
    click.echo(f"[*] Parsing document: {doc_file.name} using {parser.upper()} parser...")

    try:
        parser_instance = ParserRegistry.get(parser)
        opts = ParserOptions(
            extract_tables=extract_tables,
            ocr_enabled=ocr,
            max_pages=max_pages,
        )
        parsed_doc = parser_instance.parse(doc_file, opts)

        # Also build structural index for comprehensive artifact
        index = DocumentIndexer.build_index(parsed_doc)

        output_data = {
            "document_metadata": parsed_doc.metadata.model_dump(mode="json"),
            "parsed_document": parsed_doc.model_dump(mode="json"),
            "document_index": index.model_dump(mode="json"),
        }

        dest = output or f"{doc_file.stem}_parsed.json"
        saved_path = ArtifactWriter.write_json(output_data, dest)
        click.secho(f"[+] Successfully parsed {len(parsed_doc.pages)} pages.", fg="green")
        click.secho(f"[+] Artifact saved to: {saved_path}", fg="green")

    except Exception as e:
        click.secho(f"[!] Parsing error: {e}", fg="red", err=True)
        sys.exit(1)


@main.command("intelligence")
@click.argument("document_path", type=click.Path(exists=True, dir_okay=False))
@click.option(
    "--task",
    "-t",
    type=click.Path(exists=True, dir_okay=False),
    required=False,
    help="Path to task specification JSON file.",
)
@click.option(
    "--parser",
    "-p",
    default="pymupdf",
    type=click.Choice(["pymupdf", "docling", "llamaparse"], case_sensitive=False),
    help="Parsing engine adapter to use.",
)
@click.option(
    "--provider",
    default=None,
    type=click.Choice(["muse", "openai", "gemini", "mock"], case_sensitive=False),
    help="Model provider (defaults to 'muse' using MUSE_API_KEY from .env).",
)
@click.option(
    "--model",
    "-m",
    default=None,
    help="Model identifier (e.g. muse model name, or set MUSE_MODEL in .env).",
)
@click.option(
    "--base-url",
    default=None,
    help="Custom API base URL (or set MUSE_BASE_URL in .env).",
)
@click.option(
    "--api-key",
    default=None,
    help="API key (defaults to MUSE_API_KEY or OPENAI_API_KEY from .env).",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(dir_okay=False),
    default=None,
    help="Destination path for intelligence JSON artifact.",
)
def intelligence_cmd(
    document_path: str,
    task: Optional[str],
    parser: str,
    provider: Optional[str],
    model: Optional[str],
    base_url: Optional[str],
    api_key: Optional[str],
    output: Optional[str],
):
    """Stages 1-7: Parse, index, investigate relevant pages, and extract structured findings."""
    doc_file = Path(document_path).resolve()
    click.echo(f"[*] Starting Document Intelligence Engine on: {doc_file.name}")

    try:
        # 1. Parse
        parser_instance = ParserRegistry.get(parser)
        parsed_doc = parser_instance.parse(doc_file)
        click.echo(f"[*] Parsed {len(parsed_doc.pages)} pages with {parser.upper()}.")

        # 2. Task loading
        task_spec = None
        if task:
            task_spec = TaskLoader.from_json_file(task)
            click.echo(f"[*] Loaded task '{task_spec.task_id}': {task_spec.objective}")

        # 3. Model provider
        model_p = ProviderFactory.create(
            provider_type=provider,
            model_name=model,
            api_key=api_key,
            base_url=base_url,
        )
        click.echo(f"[*] Using model provider: {model_p.provider_name}")

        # 4. Pipeline execution
        pipeline = IntelligencePipeline(model_provider=model_p)
        result = pipeline.run(document=parsed_doc, task=task_spec)

        dest = output or f"{doc_file.stem}_intelligence.json"
        saved_path = ArtifactWriter.write_json(result, dest)

        click.secho(
            f"[+] Extraction complete. Findings: {len(result.findings)}, "
            f"Model calls: {result.total_model_calls}, Tokens: {result.total_tokens_used}",
            fg="green",
        )
        click.secho(f"[+] Intelligence artifact written to: {saved_path}", fg="green")

    except Exception as e:
        click.secho(f"[!] Intelligence execution error: {e}", fg="red", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
