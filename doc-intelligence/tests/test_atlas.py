from __future__ import annotations

import json
import pytest
from pathlib import Path
from typing import List

from doc_intelligence.atlas.builder import DocumentAtlasBuilder
from doc_intelligence.atlas.keyphrases import KeyphraseExtractor
from doc_intelligence.atlas.models import (
    AtlasPage,
    AtlasSection,
    DocumentAtlas,
    PageStructuralMetadata,
    SearchResultItem,
)
from doc_intelligence.atlas.search import AtlasSearcher
from doc_intelligence.atlas.structure import StructuralExtractor
from doc_intelligence.atlas.toc import TOCExtractor
from doc_intelligence.models.document import (
    BlockType,
    BoundingBox,
    ContentBlock,
    DocumentMetadata,
    ImageData,
    Page,
    ParsedDocument,
    TableData,
)
from doc_intelligence.providers.base import BaseModelProvider, ModelResponse


class MockTOCModelProvider(BaseModelProvider):
    """Mock model provider returning structured TOC response for testing."""

    def __init__(self, response_payload: str):
        self.response_payload = response_payload
        self.call_count = 0

    @property
    def provider_name(self) -> str:
        return "mock-muse"

    def complete(
        self,
        prompt: str,
        system_instruction: str = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        reasoning_effort: str = None,
    ) -> ModelResponse:
        self.call_count += 1
        return ModelResponse(
            content=self.response_payload,
            prompt_tokens=50,
            completion_tokens=50,
            model_name="mock-muse",
        )


def create_synthetic_document() -> ParsedDocument:
    """Creates a 6-page synthetic ParsedDocument for testing."""
    pages = [
        # Page 1: Title and Header
        Page(
            page_number=1,
            printed_page_number="i",
            text="Central Ground Water Board Report on Aquifer Systems in Western Gujarat. 2022.",
            blocks=[
                ContentBlock(
                    block_id="p1_b1",
                    page_number=1,
                    block_type=BlockType.TITLE,
                    text="Aquifer Systems in Western Gujarat",
                    level=1,
                )
            ],
        ),
        # Page 2: Printed Table of Contents
        Page(
            page_number=2,
            printed_page_number="ii",
            text=(
                "TABLE OF CONTENTS\n"
                "1.0 Introduction and Regional Geology ...... 3\n"
                "2.0 Hydrogeology and Aquifer Parameters .... 4\n"
                "3.0 Groundwater Monitoring Network ......... 5\n"
                "Annexure I: Historical Water Levels ........ 6\n"
            ),
            blocks=[
                ContentBlock(
                    block_id="p2_b1",
                    page_number=2,
                    block_type=BlockType.TITLE,
                    text="TABLE OF CONTENTS",
                    level=1,
                ),
                ContentBlock(
                    block_id="p2_b2",
                    page_number=2,
                    block_type=BlockType.PARAGRAPH,
                    text="1.0 Introduction and Regional Geology ...... 3\n2.0 Hydrogeology and Aquifer Parameters .... 4",
                ),
            ],
        ),
        # Page 3: Introduction
        Page(
            page_number=3,
            printed_page_number="3",
            text=(
                "1.0 Introduction and Regional Geology\n"
                "The study area comprises alluvial plains and basalt formations in Western Gujarat. "
                "Sedimentary sequences include sandstone and clay layers. Groundwater recharge depends "
                "on seasonal monsoonal precipitation across the catchment basin. Several lithological units "
                "have been identified based on exploratory drilling records."
            ),
            blocks=[
                ContentBlock(
                    block_id="p3_b1",
                    page_number=3,
                    block_type=BlockType.HEADING,
                    text="1.0 Introduction and Regional Geology",
                    level=1,
                ),
                ContentBlock(
                    block_id="p3_b2",
                    page_number=3,
                    block_type=BlockType.PARAGRAPH,
                    text="The study area comprises alluvial plains and basalt formations.",
                ),
            ],
        ),
        # Page 4: Hydrogeology & Aquifer Parameters (with Table & Figure)
        Page(
            page_number=4,
            printed_page_number="4",
            text=(
                "2.0 Hydrogeology and Aquifer Parameters\n"
                "Transmissivity values range from 150 to 850 m2/day. Specific yield is estimated at 0.12. "
                "Table 2.1: Hydraulic Conductivity in Unconfined Formations.\n"
                "Note: Values derived from pumping tests conducted during May 2021."
            ),
            blocks=[
                ContentBlock(
                    block_id="p4_b1",
                    page_number=4,
                    block_type=BlockType.HEADING,
                    text="2.0 Hydrogeology and Aquifer Parameters",
                    level=1,
                ),
                ContentBlock(
                    block_id="p4_b2",
                    page_number=4,
                    block_type=BlockType.CAPTION,
                    text="Table 2.1: Hydraulic Conductivity in Unconfined Formations",
                ),
                ContentBlock(
                    block_id="p4_b3",
                    page_number=4,
                    block_type=BlockType.FOOTNOTE,
                    text="Note: Values derived from pumping tests conducted during May 2021.",
                ),
            ],
            tables=[
                TableData(
                    table_id="tbl_2_1",
                    page_number=4,
                    caption="Table 2.1: Hydraulic Conductivity in Unconfined Formations",
                    headers=["Formation", "Hydraulic Conductivity (m/day)", "Specific Yield"],
                    rows=[["Alluvium", "12.5", "0.15"], ["Sandstone", "4.2", "0.08"]],
                )
            ],
            images=[
                ImageData(
                    image_id="fig_2_1",
                    page_number=4,
                    caption="Figure 2.1: Hydrogeological Cross Section",
                )
            ],
        ),
        # Page 5: Groundwater Monitoring Network
        Page(
            page_number=5,
            printed_page_number="5",
            text=(
                "3.0 Groundwater Monitoring Network\n"
                "A total of 45 piezometers and dug wells are monitored across the district. "
                "Water levels are measured four times a year: January, May, August, and November. "
                "Long-term decadal trends indicate a decline of 0.25 meters per year in deep aquifers."
            ),
            blocks=[
                ContentBlock(
                    block_id="p5_b1",
                    page_number=5,
                    block_type=BlockType.HEADING,
                    text="3.0 Groundwater Monitoring Network",
                    level=1,
                ),
            ],
        ),
        # Page 6: Annexure I
        Page(
            page_number=6,
            printed_page_number="6",
            text=(
                "Annexure I: Historical Water Levels\n"
                "Detailed well observation records across Gujarat monitoring stations.\n"
                "Table A1: Well Water Level Records 2018-2022."
            ),
            blocks=[
                ContentBlock(
                    block_id="p6_b1",
                    page_number=6,
                    block_type=BlockType.HEADING,
                    text="Annexure I: Historical Water Levels",
                    level=1,
                ),
            ],
            tables=[
                TableData(
                    table_id="tbl_annex_1",
                    page_number=6,
                    caption="Table A1: Well Water Level Records 2018-2022",
                    headers=["Well ID", "Location", "Depth to Water (mbgl)"],
                    rows=[["GJ01", "Gandhinagar", "18.5"], ["GJ02", "Kalol", "24.1"]],
                )
            ],
        ),
    ]

    metadata = DocumentMetadata(
        document_id="doc_synth_test_01",
        filename="synthetic_hydro_report.pdf",
        file_path="/tmp/synthetic_hydro_report.pdf",
        file_size_bytes=10240,
        file_hash_sha256="abc123hash",
        page_count=len(pages),
    )

    return ParsedDocument(
        metadata=metadata,
        pages=pages,
        parser_name="mock_parser",
        parser_version="1.0.0",
        parsing_time_seconds=0.05,
    )


def test_keyphrase_extraction():
    text = (
        "Hydraulic conductivity and aquifer transmissivity are critical hydrogeological parameters. "
        "The Central Ground Water Board conducts comprehensive pumping tests to evaluate specific yield. "
        "Groundwater recharge mechanisms govern subsurface water storage in alluvial aquifers."
    )
    keyphrases = KeyphraseExtractor.extract_page_keyphrases(
        page_text=text,
        corpus_dfs={"conductivity": 1, "hydraulic": 1, "aquifer": 2},
        total_pages=5,
        min_keyphrases=3,
        max_keyphrases=6,
    )
    assert len(keyphrases) >= 3
    assert len(keyphrases) <= 6
    # Stop words should not be present as keyphrases
    assert "the" not in keyphrases
    assert "and" not in keyphrases
    # Check that meaningful phrases or collocations are extracted
    combined = " ".join(keyphrases)
    assert any(term in combined for term in ["hydraulic", "aquifer", "water", "conductivity", "ground"])


def test_structural_extraction():
    doc = create_synthetic_document()
    p4 = doc.pages[3]  # Page 4
    meta = StructuralExtractor.extract_page_structure(p4)

    assert meta.has_tables is True
    assert "tbl_2_1" in meta.table_ids
    assert len(meta.table_captions) > 0
    assert "Hydraulic Conductivity" in meta.table_captions[0]
    assert meta.has_figures is True
    assert "fig_2_1" in meta.figure_ids
    assert any("Note:" in fn for fn in meta.footnotes)

    # Check Page 6 annexures
    p6 = doc.pages[5]
    meta6 = StructuralExtractor.extract_page_structure(p6)
    assert len(meta6.annexures) > 0
    assert "Annexure" in meta6.annexures[0]


def test_toc_with_bookmarks():
    doc = create_synthetic_document()
    doc.metadata.custom_metadata["bookmarks"] = [
        [1, "Chapter 1: Geology", 3],
        [1, "Chapter 2: Hydrogeology", 4],
        [2, "Section 2.1: Hydraulic Testing", 4],
        [1, "Chapter 3: Monitoring", 5],
    ]
    sections, source, toc_pages = TOCExtractor.extract_or_infer_toc(doc)

    assert source == "original_bookmark"
    assert len(sections) == 3  # Two level 1 sections and one with a subsection
    assert sections[0].title == "Chapter 1: Geology"
    assert sections[0].start_page == 3
    assert sections[0].end_page == 3
    assert sections[1].title == "Chapter 2: Hydrogeology"
    assert sections[1].start_page == 4
    assert len(sections[1].subsections) == 1
    assert sections[1].subsections[0].title == "Section 2.1: Hydraulic Testing"


def test_toc_printed_with_mock_muse():
    doc = create_synthetic_document()
    muse_response = json.dumps(
        {
            "sections": [
                {"title": "Introduction and Regional Geology", "level": 1, "printed_page": "3"},
                {"title": "Hydrogeology and Aquifer Parameters", "level": 1, "printed_page": "4"},
                {"title": "Groundwater Monitoring Network", "level": 1, "printed_page": "5"},
                {"title": "Annexure I: Historical Water Levels", "level": 1, "printed_page": "6"},
            ]
        }
    )
    mock_provider = MockTOCModelProvider(muse_response)

    sections, source, toc_pages = TOCExtractor.extract_or_infer_toc(doc, provider=mock_provider)

    assert source == "original_toc"
    assert toc_pages == [2]  # TOC is on page 2
    assert mock_provider.call_count == 1
    assert len(sections) == 4
    assert sections[0].title == "Introduction and Regional Geology"
    assert sections[0].start_page == 3
    assert sections[1].start_page == 4
    assert sections[3].title == "Annexure I: Historical Water Levels"
    assert sections[3].start_page == 6
    assert sections[3].end_page == 6


def test_toc_fallback_regex_and_inferred():
    doc = create_synthetic_document()
    # Test regex extraction without provider
    sections, source, toc_pages = TOCExtractor.extract_or_infer_toc(doc, provider=None)
    assert source == "original_toc"
    assert len(sections) >= 3

    # Test inferred fallback when no TOC page exists
    doc_no_toc = create_synthetic_document()
    doc_no_toc.pages = [doc.pages[2], doc.pages[3]]  # only pages 3 and 4
    for idx, p in enumerate(doc_no_toc.pages, start=1):
        p.page_number = idx
    sections_inf, source_inf, _ = TOCExtractor.extract_or_infer_toc(doc_no_toc, provider=None)
    assert source_inf == "inferred"
    assert len(sections_inf) > 0


def test_document_atlas_builder_and_search():
    doc = create_synthetic_document()
    atlas = DocumentAtlasBuilder.build(doc, provider=None)

    assert atlas.total_pages == 6
    assert len(atlas.pages) == 6
    assert len(atlas.sections) > 0

    # Test page structural and keyphrase properties
    p4 = atlas.get_page(4)
    assert p4 is not None
    assert p4.page_number == 4
    assert len(p4.keyphrases) >= 5
    assert p4.structural_metadata.has_tables is True

    # Test section lookup
    sec_hydro = atlas.get_section("Hydrogeology")
    assert sec_hydro is not None
    sec_range = atlas.get_section_range("Hydrogeology")
    assert sec_range is not None
    assert sec_range[0] == 4

    # Test Ranked Hybrid Search
    results = atlas.search("hydraulic conductivity pumping tests", top_k=3)
    assert len(results) > 0
    # Page 4 contains hydraulic conductivity, table and footnote, so it should be #1
    assert results[0].page_number == 4
    assert results[0].score > 0.0
    assert len(results[0].matched_tables) > 0

    # Test Section Range Expansion
    annex_results = atlas.search("Annexure water levels", top_k=2, expand_section_range=True)
    assert len(annex_results) > 0
    assert any(r.page_number == 6 for r in annex_results)


def test_atlas_serialization(tmp_path: Path):
    doc = create_synthetic_document()
    atlas = DocumentAtlasBuilder.build(doc, provider=None)

    json_file = tmp_path / "test_atlas.json"
    DocumentAtlasBuilder.save_to_json(atlas, json_file)

    loaded = DocumentAtlasBuilder.load_from_json(json_file)
    assert loaded.document_id == atlas.document_id
    assert loaded.total_pages == atlas.total_pages
    assert len(loaded.pages) == len(atlas.pages)
    assert len(loaded.sections) == len(atlas.sections)
    assert loaded.get_page(4).structural_metadata.has_tables is True
