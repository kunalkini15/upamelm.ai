from __future__ import annotations

import time
from pathlib import Path
from typing import List, Optional

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


class DoclingParser(BaseParser):
    @property
    def name(self) -> str:
        return "docling"

    def parse(self, file_path: Path, options: Optional[ParserOptions] = None) -> ParsedDocument:
        opts = options or ParserOptions()
        file_path = Path(file_path).resolve()
        start_time = time.perf_counter()
        warnings: List[str] = []

        try:
            from docling.document_converter import DocumentConverter, PdfFormatOption
            from docling.datamodel.pipeline_options import PdfPipelineOptions
            from docling.datamodel.base_models import InputFormat
            import docling

            version = getattr(docling, "__version__", "unknown")

            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = opts.ocr_enabled
            pipeline_options.do_table_structure = opts.extract_tables

            doc_converter = DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
                }
            )

            conv_res = doc_converter.convert(file_path)
            docling_doc = conv_res.document

            # Pages in docling
            total_pages = len(docling_doc.pages) if hasattr(docling_doc, "pages") else 1
            pages_map: dict[int, Page] = {}

            # Initialize pages
            for p_no in range(1, total_pages + 1):
                p_dim = docling_doc.pages.get(p_no) if hasattr(docling_doc, "pages") and isinstance(docling_doc.pages, dict) else None
                w = float(getattr(p_dim, "size", None).width) if p_dim and hasattr(p_dim, "size") and p_dim.size else 612.0
                h = float(getattr(p_dim, "size", None).height) if p_dim and hasattr(p_dim, "size") and p_dim.size else 792.0
                pages_map[p_no] = Page(
                    page_number=p_no,
                    width=w,
                    height=h,
                    text="",
                    blocks=[],
                    tables=[],
                    images=[],
                )

            # Iterate over elements/texts
            block_idx = 0
            if hasattr(docling_doc, "texts"):
                for item in docling_doc.texts:
                    page_no = 1
                    bbox = None
                    if hasattr(item, "prov") and item.prov:
                        prov = item.prov[0]
                        page_no = getattr(prov, "page_no", 1)
                        if hasattr(prov, "bbox") and prov.bbox:
                            bbox = BoundingBox(
                                x0=float(prov.bbox.l),
                                y0=float(prov.bbox.t),
                                x1=float(prov.bbox.r),
                                y1=float(prov.bbox.b),
                            )

                    label_str = str(getattr(item, "label", "paragraph")).lower()
                    b_type = BlockType.PARAGRAPH
                    level = None
                    if "title" in label_str:
                        b_type = BlockType.TITLE
                        level = 1
                    elif "heading" in label_str or "section" in label_str:
                        b_type = BlockType.HEADING
                        level = 2

                    block_idx += 1
                    block = ContentBlock(
                        block_id=f"docling_b{block_idx}",
                        page_number=page_no,
                        block_type=b_type,
                        text=item.text,
                        level=level,
                        bbox=bbox,
                    )
                    if page_no in pages_map:
                        pages_map[page_no].blocks.append(block)
                        if pages_map[page_no].text:
                            pages_map[page_no].text += "\n\n" + item.text
                        else:
                            pages_map[page_no].text = item.text

            # Iterate over tables
            if hasattr(docling_doc, "tables") and opts.extract_tables:
                for t_idx, table in enumerate(docling_doc.tables):
                    page_no = 1
                    bbox = None
                    if hasattr(table, "prov") and table.prov:
                        prov = table.prov[0]
                        page_no = getattr(prov, "page_no", 1)
                        if hasattr(prov, "bbox") and prov.bbox:
                            bbox = BoundingBox(
                                x0=float(prov.bbox.l),
                                y0=float(prov.bbox.t),
                                x1=float(prov.bbox.r),
                                y1=float(prov.bbox.b),
                            )

                    headers: List[str] = []
                    rows: List[List[str]] = []
                    # Try export to dataframe or markdown
                    md_text = ""
                    try:
                        if hasattr(table, "export_to_markdown"):
                            md_text = table.export_to_markdown()
                        elif hasattr(table, "export_to_dataframe"):
                            df = table.export_to_dataframe()
                            headers = list(df.columns)
                            rows = [[str(val) for val in row] for row in df.values.tolist()]
                    except Exception as te:
                        warnings.append(f"Table conversion warning: {te}")

                    t_data = TableData(
                        table_id=f"docling_t{t_idx+1}",
                        page_number=page_no,
                        headers=headers,
                        rows=rows,
                        bbox=bbox,
                        markdown=md_text,
                    )
                    if page_no in pages_map:
                        pages_map[page_no].tables.append(t_data)

            # If pages_map is empty or has no text, populate from markdown export
            if not pages_map or all(not p.text for p in pages_map.values()):
                full_md = docling_doc.export_to_markdown() if hasattr(docling_doc, "export_to_markdown") else ""
                pages_map[1] = Page(
                    page_number=1,
                    text=full_md,
                    blocks=[
                        ContentBlock(
                            block_id="docling_b1",
                            page_number=1,
                            text=full_md,
                            block_type=BlockType.PARAGRAPH,
                        )
                    ],
                )

            pages = sorted(pages_map.values(), key=lambda p: p.page_number)
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
            # Fall back gracefully or raise informative error
            raise RuntimeError(f"Docling parsing failed: {e}") from e
