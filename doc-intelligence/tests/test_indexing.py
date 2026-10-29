import pytest
from pathlib import Path
import fitz
from doc_intelligence.parsers.pymupdf_parser import PyMuPDFParser
from doc_intelligence.indexing.indexer import DocumentIndexer

@pytest.fixture
def multi_page_doc(tmp_path):
    test_pdf = tmp_path / "multi.pdf"
    doc = fitz.open()

    # Page 1
    p1 = doc.new_page()
    p1.insert_text((50, 50), "Overview and Background", fontsize=16)
    p1.insert_text((50, 100), "This report examines solar radiation and photovoltaic efficiency.", fontsize=11)

    # Page 2
    p2 = doc.new_page()
    p2.insert_text((50, 50), "Financial Performance Analysis", fontsize=16)
    p2.insert_text((50, 100), "Capital expenditure was reduced by 14 percent across all sites.", fontsize=11)

    doc.save(str(test_pdf))
    doc.close()

    parser = PyMuPDFParser()
    return parser.parse(test_pdf)

def test_document_indexing(multi_page_doc):
    index = DocumentIndexer.build_index(multi_page_doc)

    assert index.total_pages == 2
    assert len(index.sections) == 2
    assert index.sections[0].title == "Overview and Background"
    assert index.sections[0].page_number == 1
    assert index.sections[1].title == "Financial Performance Analysis"
    assert index.sections[1].page_number == 2

    # Verify vocabulary and query retrieval
    assert "photovoltaic" in index.vocabulary
    assert index.vocabulary["photovoltaic"] == [1]
    assert "expenditure" in index.vocabulary
    assert index.vocabulary["expenditure"] == [2]

    # Test query relevant pages
    pages_solar = DocumentIndexer.query_relevant_pages(index, ["solar radiation"])
    assert 1 in pages_solar

    pages_finance = DocumentIndexer.query_relevant_pages(index, ["expenditure and capital"])
    assert 2 in pages_finance
