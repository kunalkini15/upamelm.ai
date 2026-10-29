import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from doc_intelligence.parsers.docling_parser import DoclingParser
from doc_intelligence.parsers.base import ParserOptions

def test_docling_parser_interface():
    parser = DoclingParser()
    assert parser.name == "docling"

def test_docling_parser_mocked_conversion(tmp_path):
    parser = DoclingParser()
    test_file = tmp_path / "mock.pdf"
    test_file.write_bytes(b"%PDF-1.4 dummy")

    # Mock docling DocumentConverter
    with patch("docling.document_converter.DocumentConverter") as mock_converter_cls:
        mock_converter = MagicMock()
        mock_converter_cls.return_value = mock_converter

        mock_conv_res = MagicMock()
        mock_doc = MagicMock()
        mock_doc.pages = {1: MagicMock(size=MagicMock(width=600, height=800))}
        mock_text_item = MagicMock()
        mock_text_item.text = "Mocked Docling Paragraph"
        mock_text_item.label = "paragraph"
        mock_text_item.prov = []
        mock_doc.texts = [mock_text_item]
        mock_doc.tables = []
        mock_conv_res.document = mock_doc
        mock_converter.convert.return_value = mock_conv_res

        parsed = parser.parse(test_file)
        assert parsed.metadata.filename == "mock.pdf"
        assert parsed.parser_name == "docling"
        assert len(parsed.pages) == 1
        assert "Mocked Docling Paragraph" in parsed.pages[0].text
