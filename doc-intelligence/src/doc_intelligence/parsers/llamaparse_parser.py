from __future__ import annotations

import os
import time
from pathlib import Path
from typing import List, Optional

from doc_intelligence.models.document import (
    BlockType,
    ContentBlock,
    Page,
    ParsedDocument,
    TableData,
)
from doc_intelligence.parsers.base import BaseParser, ParserOptions


class LlamaParseParser(BaseParser):
    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or os.environ.get("LLAMA_CLOUD_API_KEY")

    @property
    def name(self) -> str:
        return "llamaparse"

    def parse(self, file_path: Path, options: Optional[ParserOptions] = None) -> ParsedDocument:
        opts = options or ParserOptions()
        file_path = Path(file_path).resolve()
        start_time = time.perf_counter()
        warnings: List[str] = []

        api_key = self._api_key or os.environ.get("LLAMA_CLOUD_API_KEY")
        if not api_key:
            raise ValueError(
                "LlamaParse requires an API key. Please set LLAMA_CLOUD_API_KEY environment variable "
                "or configure LlamaParseParser(api_key=...)."
            )

        try:
            from llama_parse import LlamaParse
            import llama_parse

            version = getattr(llama_parse, "__version__", "unknown")

            parser = LlamaParse(
                api_key=api_key,
                result_type="markdown",
                verbose=False,
            )

            # llama-parse returns documents corresponding to parsed markdown
            docs = parser.load_data(str(file_path))

            pages: List[Page] = []
            for idx, doc in enumerate(docs):
                page_num = idx + 1
                text = doc.text or ""

                blocks: List[ContentBlock] = []
                tables: List[TableData] = []

                # Simple block separation by double newlines
                raw_blocks = text.split("\n\n")
                for b_i, raw_b in enumerate(raw_blocks):
                    raw_b_strip = raw_b.strip()
                    if not raw_b_strip:
                        continue

                    # Markdown table check
                    if "|" in raw_b_strip and "-|-" in raw_b_strip:
                        lines = [line.strip() for line in raw_b_strip.split("\n") if line.strip()]
                        headers = [c.strip() for c in lines[0].strip("|").split("|")] if lines else []
                        rows = []
                        for r_line in lines[2:]:
                            rows.append([c.strip() for c in r_line.strip("|").split("|")])

                        tables.append(
                            TableData(
                                table_id=f"lp_p{page_num}_t{len(tables)+1}",
                                page_number=page_num,
                                headers=headers,
                                rows=rows,
                                markdown=raw_b_strip,
                            )
                        )
                        continue

                    b_type = BlockType.PARAGRAPH
                    level = None
                    if raw_b_strip.startswith("# "):
                        b_type = BlockType.TITLE
                        level = 1
                    elif raw_b_strip.startswith("## "):
                        b_type = BlockType.HEADING
                        level = 2
                    elif raw_b_strip.startswith("### "):
                        b_type = BlockType.HEADING
                        level = 3

                    clean_text = raw_b_strip.lstrip("#").strip()
                    blocks.append(
                        ContentBlock(
                            block_id=f"lp_p{page_num}_b{b_i+1}",
                            page_number=page_num,
                            block_type=b_type,
                            text=clean_text,
                            level=level,
                        )
                    )

                pages.append(
                    Page(
                        page_number=page_num,
                        text=text,
                        blocks=blocks,
                        tables=tables,
                    )
                )

            if opts.max_pages and len(pages) > opts.max_pages:
                pages = pages[: opts.max_pages]

            metadata = self.compute_metadata(file_path, len(pages))
            duration = time.perf_counter() - start_time

            return ParsedDocument(
                metadata=metadata,
                pages=pages,
                parser_name=self.name,
                parser_version=version,
                parsing_time_seconds=duration,
                parsing_warnings=warnings,
            )

        except Exception as e:
            raise RuntimeError(f"LlamaParse failed: {e}") from e
