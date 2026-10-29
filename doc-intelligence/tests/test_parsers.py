import pytest
from pathlib import Path
from doc_intelligence.models.document import BlockType, BoundingBox, ContentBlock, Page, ParsedDocument
from doc_intelligence.parsers.pymupdf_parser import PyMuPDFParser
from doc_intelligence.parsers.docling_parser import DoclingParser
from doc_intelligence.parsers.llamaparse_parser import LlamaParseParser
from doc_intelligence.parsers.registry import ParserRegistry
from doc_intelligence.parsers.base import ParserOptions

def test_parser_registry():
    parsers = ParserRegistry.list_available()
    assert "pymupdf" in parsers
    assert "docling" in parsers
    assert "llamaparse" in parsers

    p_mupdf = ParserRegistry.get("pymupdf")
    assert isinstance(p_mupdf, PyMuPDFParser)

    p_docling = ParserRegistry.get("docling")
    assert isinstance(p_docling, DoclingParser)

    p_llama = ParserRegistry.get("llamaparse")
    assert isinstance(p_llama, LlamaParseParser)

def test_pymupdf_parser_local_pdf(tmp_path):
    import fitz
    test_pdf = tmp_path / "test.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Document Title Header", fontsize=18)
    page.insert_text((50, 100), "Sample body paragraph describing findings.", fontsize=11)
    doc.save(str(test_pdf))
    doc.close()

    parser = PyMuPDFParser()
    result = parser.parse(test_pdf)

    assert result.metadata.page_count == 1
    assert result.metadata.filename == "test.pdf"
    assert len(result.pages) == 1
    assert "Document Title Header" in result.pages[0].text
    assert len(result.pages[0].blocks) >= 2
    # Check title block level classification
    title_block = [b for b in result.pages[0].blocks if b.block_type == BlockType.TITLE]
    assert len(title_block) == 1
    assert title_block[0].level == 1
    assert title_block[0].bbox is not None

def test_llamaparse_without_api_key(tmp_path):
    parser = LlamaParseParser(api_key=None)
    # Ensure without environment variable it raises clean ValueError
    import os
    old_val = os.environ.pop("LLAMA_CLOUD_API_KEY", None)
    try:
        with pytest.raises(ValueError, match="requires an API key"):
            parser.parse(tmp_path / "dummy.pdf")
    finally:
        if old_val:
            os.environ["LLAMA_CLOUD_API_KEY"] = old_val
