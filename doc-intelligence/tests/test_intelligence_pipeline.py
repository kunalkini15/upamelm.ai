import pytest
from doc_intelligence.models.document import ContentBlock, DocumentMetadata, Page, ParsedDocument
from doc_intelligence.models.task import TaskSpecification, VerificationStatus
from doc_intelligence.pipeline.extractor import IntelligencePipeline
from doc_intelligence.providers.mock_provider import MockModelProvider

@pytest.fixture
def sample_parsed_document():
    page1 = Page(
        page_number=1,
        printed_page_number="1",
        text="Executive Summary: Turbine 7 recorded vibrational frequency of 42.5 Hz on 12-Oct-2025.",
        blocks=[
            ContentBlock(
                block_id="b1",
                page_number=1,
                text="Executive Summary: Turbine 7 recorded vibrational frequency of 42.5 Hz on 12-Oct-2025.",
                level=None,
            )
        ],
    )
    metadata = DocumentMetadata(
        document_id="doc_sample_123",
        filename="turbine_report.pdf",
        file_path="/fake/turbine_report.pdf",
        file_size_bytes=1024,
        file_hash_sha256="abc1234567890",
        page_count=1,
    )
    return ParsedDocument(
        metadata=metadata,
        pages=[page1],
        parser_name="mock_parser",
    )

def test_pipeline_with_grounded_mock_data(sample_parsed_document):
    mock_data = {
        "findings": [
            {
                "finding_id": "f_01",
                "values": {
                    "equipment": "Turbine 7",
                    "frequency": "42.5 Hz",
                    "date": "12-Oct-2025",
                    "nonexistent_field": None,
                },
                "page_number": 1,
                "source_text": "Turbine 7 recorded vibrational frequency of 42.5 Hz",
                "confidence": 0.95,
            }
        ]
    }
    provider = MockModelProvider(default_json=mock_data)

    task = TaskSpecification(
        task_id="turbine_extraction",
        objective="Extract turbine sensor recordings",
        fields=["equipment", "frequency", "date", "nonexistent_field"],
    )

    pipeline = IntelligencePipeline(model_provider=provider)
    result = pipeline.run(document=sample_parsed_document, task=task)

    assert result.task_id == "turbine_extraction"
    assert len(result.findings) == 1

    finding = result.findings[0]
    # Grounded values should be VERIFIED
    assert finding.fields["equipment"].status == VerificationStatus.VERIFIED
    assert finding.fields["equipment"].evidence is not None
    assert finding.fields["equipment"].evidence.page_number == 1
    assert finding.fields["equipment"].evidence.printed_page_number == "1"

    # Missing field should be MISSING
    assert finding.fields["nonexistent_field"].status == VerificationStatus.MISSING
    assert finding.fields["nonexistent_field"].evidence is None

    # Check trace execution
    assert len(result.execution_trace) >= 3
    assert result.total_model_calls == 1

def test_pipeline_handles_hallucinated_source_as_ambiguous(sample_parsed_document):
    # Model claims source text that is nowhere on page 1
    mock_data = {
        "findings": [
            {
                "finding_id": "f_hallucinated",
                "values": {"equipment": "Reactor 9"},
                "page_number": 1,
                "source_text": "Reactor 9 produced critical thermal variance.",
                "confidence": 0.95,
            }
        ]
    }
    provider = MockModelProvider(default_json=mock_data)
    task = TaskSpecification(
        task_id="hallucination_check",
        objective="Check reactor parameters",
        fields=["equipment"],
    )
    pipeline = IntelligencePipeline(model_provider=provider)
    result = pipeline.run(document=sample_parsed_document, task=task)

    finding = result.findings[0]
    assert finding.fields["equipment"].status == VerificationStatus.AMBIGUOUS
    assert finding.is_ambiguous is True
    assert "could not be strictly grounded" in finding.fields["equipment"].validation_notes
