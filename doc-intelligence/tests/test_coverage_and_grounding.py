import pytest
from doc_intelligence.models.document import ContentBlock, DocumentMetadata, Page, ParsedDocument
from doc_intelligence.models.task import CoverageScope, TaskSpecification, VerificationStatus
from doc_intelligence.pipeline.coverage import CoveragePlanner
from doc_intelligence.pipeline.extractor import IntelligencePipeline
from doc_intelligence.pipeline.grounding import GroundingVerifier
from doc_intelligence.providers.mock_provider import MockModelProvider

def test_coverage_planner_expansion():
    # Construct multi-page parsed doc where page 2 has tables that continue onto page 3 and 4
    pages = [
        Page(page_number=1, text="Introduction and Executive Summary"),
        Page(page_number=2, text="Annexure 1: Table of Wells", tables=[{"table_id": "t1", "page_number": 2, "headers": ["Well", "Depth"], "rows": [["W1", "100"]]}]),
        Page(page_number=3, text="Continuation of Annexure 1", tables=[{"table_id": "t2", "page_number": 3, "headers": ["Well", "Depth"], "rows": [["W2", "120"]]}]),
        Page(page_number=4, text="Continuation of Annexure 1", tables=[{"table_id": "t3", "page_number": 4, "headers": ["Well", "Depth"], "rows": [["W3", "140"]]}]),
        Page(page_number=5, text="General Conclusions", tables=[]),
    ]
    doc = ParsedDocument(
        metadata=DocumentMetadata(
            document_id="doc_cov_test",
            filename="cov.pdf",
            file_path="/fake/cov.pdf",
            file_size_bytes=1000,
            file_hash_sha256="hash123",
            page_count=5,
        ),
        pages=pages,
        parser_name="mock",
    )
    from doc_intelligence.indexing.indexer import DocumentIndexer
    index = DocumentIndexer.build_index(doc)

    task_sample = TaskSpecification(
        task_id="well_inventory_sample",
        objective="Extract well inventory from annexure 1",
        fields=["well", "depth"],
        coverage_scope=CoverageScope.SAMPLE,
        max_relevant_pages=2,
    )
    planned_pages, manifest = CoveragePlanner.plan_coverage(doc, index, task_sample)
    assert len(planned_pages) == 2
    assert manifest.status == "partial"

    task_all = TaskSpecification(
        task_id="well_inventory_all",
        objective="Extract well inventory from annexure 1",
        fields=["well", "depth"],
        coverage_scope=CoverageScope.ALL,
        max_relevant_pages=2,
    )
    planned_pages_all, manifest_all = CoveragePlanner.plan_coverage(doc, index, task_all)
    # With ALL scope, continuation pages 3 and 4 should be automatically expanded
    assert 2 in planned_pages_all
    assert 3 in planned_pages_all
    assert 4 in planned_pages_all
    assert manifest_all.status == "complete"

def test_grounding_verifier_wrong_row():
    # Table on page with two wells
    page = Page(
        page_number=1,
        text="Sample Table",
        tables=[
            {
                "table_id": "t_sample",
                "page_number": 1,
                "headers": ["Well ID", "Depth"],
                "rows": [
                    ["W-001", "150.5"],
                    ["W-002", "85.0"],
                ]
            }
        ]
    )
    # Claiming W-001 has depth 999.9 (which is nowhere in row or page)
    status, evidence, note = GroundingVerifier.verify_field_in_page(
        page=page,
        field_name="depth",
        value="999.9",
        claimed_source_text="W-001 depth is 999.9"
    )
    assert status == VerificationStatus.AMBIGUOUS
    assert "could not be strictly grounded" in note

    # Valid value in row 1
    status_valid, evidence_valid, note_valid = GroundingVerifier.verify_field_in_page(
        page=page,
        field_name="depth",
        value="150.5",
        claimed_source_text="W-001 depth 150.5"
    )
    assert status_valid == VerificationStatus.GROUNDED
    assert evidence_valid.row_index == 0
    assert evidence_valid.table_id == "t_sample"
