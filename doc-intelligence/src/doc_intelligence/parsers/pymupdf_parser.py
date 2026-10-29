from __future__ import annotations

import time
from pathlib import Path
from typing import List, Optional
import pymupdf  # PyMuPDF

from doc_intelligence.models.document import (
    BlockType,
    BoundingBox,
    ContentBlock,
    ImageData,
    Page,
    ParsedDocument,
    TableData,
)
from doc_intelligence.parsers.base import BaseParser, ParserOptions


class PyMuPDFParser(BaseParser):
    @property
    def name(self) -> str:
        return "pymupdf"

    def parse(self, file_path: Path, options: Optional[ParserOptions] = None) -> ParsedDocument:
        opts = options or ParserOptions()
        file_path = Path(file_path).resolve()
        start_time = time.perf_counter()
        warnings: List[str] = []

        doc = pymupdf.open(str(file_path))
        total_pages = len(doc)
        max_p = min(total_pages, opts.max_pages) if opts.max_pages else total_pages

        pages: List[Page] = []

        for p_idx in range(max_p):
            page_num = p_idx + 1
            pdf_page = doc[p_idx]
            rect = pdf_page.rect
            page_width = rect.width
            page_height = rect.height

            # Extract raw text
            page_text = pdf_page.get_text("text")

            # Extract structured blocks
            content_blocks: List[ContentBlock] = []
            tables: List[TableData] = []
            images: List[ImageData] = []

            # Page blocks extraction
            text_dict = pdf_page.get_text("dict")
            block_counter = 0

            for b in text_dict.get("blocks", []):
                b_type = b.get("type", 0)
                bbox_vals = b.get("bbox", (0, 0, 0, 0))
                bbox = BoundingBox(
                    x0=bbox_vals[0],
                    y0=bbox_vals[1],
                    x1=bbox_vals[2],
                    y1=bbox_vals[3],
                )

                if b_type == 0:  # text block
                    # Reconstruct text and estimate whether it's a heading
                    lines_text = []
                    max_font_size = 0.0
                    for line in b.get("lines", []):
                        line_spans = []
                        for span in line.get("spans", []):
                            line_spans.append(span.get("text", ""))
                            font_size = span.get("size", 10.0)
                            if font_size > max_font_size:
                                max_font_size = font_size
                        lines_text.append("".join(line_spans))

                    block_text = "\n".join(lines_text).strip()
                    if not block_text:
                        continue

                    # Classify block type based on font size and length
                    block_type = BlockType.PARAGRAPH
                    level = None
                    if max_font_size >= 16.0 and len(block_text) < 150:
                        block_type = BlockType.TITLE
                        level = 1
                    elif max_font_size >= 13.0 and len(block_text) < 200:
                        block_type = BlockType.HEADING
                        level = 2
                    elif max_font_size >= 11.5 and len(block_text) < 200:
                        block_type = BlockType.HEADING
                        level = 3

                    block_counter += 1
                    content_blocks.append(
                        ContentBlock(
                            block_id=f"p{page_num}_b{block_counter}",
                            page_number=page_num,
                            block_type=block_type,
                            text=block_text,
                            level=level,
                            bbox=bbox,
                            metadata={"font_size": max_font_size},
                        )
                    )
                elif b_type == 1 and opts.extract_images:  # image block
                    images.append(
                        ImageData(
                            image_id=f"p{page_num}_img_{len(images)+1}",
                            page_number=page_num,
                            bbox=bbox,
                            width=b.get("width"),
                            height=b.get("height"),
                            format=b.get("ext"),
                        )
                    )

            # Table extraction using PyMuPDF's built-in find_tables
            if opts.extract_tables:
                try:
                    tabs = pdf_page.find_tables()
                    for t_idx, tab in enumerate(tabs):
                        t_bbox = tab.bbox
                        t_df = tab.extract()
                        if not t_df:
                            continue
                        headers = [str(col) if col is not None else "" for col in t_df[0]]
                        rows = []
                        for row in t_df[1:]:
                            rows.append([str(c) if c is not None else "" for c in row])

                        # Simple markdown representation
                        md_lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
                        for r in rows:
                            md_lines.append("| " + " | ".join(r) + " |")
                        markdown_table = "\n".join(md_lines)

                        tables.append(
                            TableData(
                                table_id=f"p{page_num}_t{t_idx+1}",
                                page_number=page_num,
                                headers=headers,
                                rows=rows,
                                bbox=BoundingBox(x0=t_bbox[0], y0=t_bbox[1], x1=t_bbox[2], y1=t_bbox[3]),
                                markdown=markdown_table,
                            )
                        )
                except Exception as e:
                    warnings.append(f"Table extraction on page {page_num} failed: {e}")

            # Detect printed page number heuristic (numbers in footer/header)
            printed_num = None
            if content_blocks:
                first_block = content_blocks[0]
                last_block = content_blocks[-1]
                for candidate in (last_block, first_block):
                    t = candidate.text.strip()
                    if t.isdigit() and len(t) <= 4:
                        printed_num = t
                        break

            pages.append(
                Page(
                    page_number=page_num,
                    printed_page_number=printed_num,
                    width=page_width,
                    height=page_height,
                    text=page_text,
                    blocks=content_blocks,
                    tables=tables,
                    images=images,
                )
            )

        metadata = self.compute_metadata(file_path, total_pages)
        pdf_meta = doc.metadata or {}
        metadata.title = pdf_meta.get("title")
        metadata.author = pdf_meta.get("author")
        metadata.creation_date = pdf_meta.get("creationDate")

        doc.close()
        duration = time.perf_counter() - start_time

        return ParsedDocument(
            metadata=metadata,
            pages=pages,
            parser_name=self.name,
            parser_version=pymupdf.__version__,
            parsing_time_seconds=duration,
            parsing_warnings=warnings,
        )
