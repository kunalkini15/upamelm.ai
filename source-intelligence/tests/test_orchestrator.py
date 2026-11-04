from datetime import date
from pathlib import Path

import httpx

from source_intelligence.config import Settings
from source_intelligence.models import AcquiredSource, Candidate, Category, CityRequest, DateEvidence, SearchResult
from source_intelligence.orchestrator import SourceIntelligence
from source_intelligence.providers.model import NullModelAssistant
from source_intelligence.util import stable_id


class FakeSearch:
    name = "fake"

    def search(self, query, limit):
        return [SearchResult(
            query_id=query.query_id, category=query.category, title=f"2026 {query.category.value} Bengaluru survey",
            url=f"https://example.com/{query.category.value}.pdf", snippet="Monitoring data 2025-2026 Bengaluru",
            provider="fake", rank=1,
        )]


class FakeInspector:
    def from_result(self, result):
        return Candidate(
            candidate_id=stable_id("candidate", result.category.value), category=result.category,
            title=result.title, landing_url=result.url, search_queries=[result.query_id],
        )

    def inspect(self, value, request):
        value.download_url = value.landing_url
        value.media_type = "application/pdf"
        value.inspected = True
        value.geographic_relevance = 1
        value.category_relevance = 1
        value.authority_score = 1
        value.scientific_utility = 0.8
        value.date_evidence = DateEvidence(
            publication_date=date(2026, 1, 1), data_period_end=date(2026, 1, 1),
            basis="document_text", confidence=0.9,
        )
        return value, "Bengaluru monitoring data 2026"


class FakeAcquirer:
    def acquire(self, candidate, root: Path):
        payload = candidate.category.value.encode()
        target = root / "documents" / candidate.category.value / "document.pdf"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        checksum = stable_id("sha", candidate.category.value).removeprefix("sha_").ljust(64, "0")
        return AcquiredSource(
            source_id=stable_id("source", checksum), category=candidate.category, title=candidate.title,
            landing_url=candidate.landing_url, download_url=candidate.download_url,
            publication_date=candidate.date_evidence.publication_date, data_period_end=candidate.date_evidence.data_period_end,
            freshness_basis="document_text", freshness_confidence=0.9, media_type="application/pdf",
            filename="document.pdf", local_path=target.relative_to(root).as_posix(), sha256=checksum,
            size_bytes=len(payload), selected_score=candidate.score, selection_reason="test",
        )


def settings() -> Settings:
    return Settings(
        search_provider="mock", google_api_key=None, google_engine_id=None, firecrawl_api_key=None,
        firecrawl_base_url="https://api.firecrawl.dev/v1", serper_api_key=None,
        serper_base_url="https://google.serper.dev", serper_gl="in", serper_hl="en",
        model_provider="none", model_api_key=None,
        model_base_url="https://api.openai.com/v1", model_name=None, model_api_style="chat_completions", timeout_seconds=5,
        max_download_bytes=1024, max_search_results=3, max_candidates_per_category=3, user_agent="test",
    )


def test_end_to_end_artifact_contract(tmp_path: Path) -> None:
    pipeline = SourceIntelligence(settings(), search_provider=FakeSearch(), model_assistant=NullModelAssistant(), client=httpx.Client())
    pipeline.inspector = FakeInspector()
    pipeline.acquirer = FakeAcquirer()
    manifest = pipeline.run(CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3)), tmp_path)
    assert len(manifest.sources) == 5
    assert all(item.status == "selected" for item in manifest.coverage)
    assert (tmp_path / "source_manifest.json").exists()
    assert (tmp_path / "rejected_sources.json").exists()
    summary = __import__("json").loads((tmp_path / "run_summary.json").read_text())
    assert summary["status"] == "completed"
    assert summary["mode"] == "full"
    assert summary["selected"] == 5


def test_query_planning_stage_does_not_search(tmp_path: Path) -> None:
    class SearchMustNotRun:
        def search(self, query, limit):
            raise AssertionError("query-planning stage must not execute search")

    pipeline = SourceIntelligence(settings(), search_provider=SearchMustNotRun(), model_assistant=NullModelAssistant(), client=httpx.Client())
    plan = pipeline.plan_queries(CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3)), tmp_path)
    assert plan.queries
    assert (tmp_path / "deterministic_coverage_plan.json").exists()
    assert (tmp_path / "coverage_plan.json").exists()
    assert not (tmp_path / "search_results.json").exists()


def test_inspect_stage_never_acquires_files(tmp_path: Path) -> None:
    class AcquireMustNotRun:
        def acquire(self, candidate, root):
            raise AssertionError("inspect stage must not download")

    pipeline = SourceIntelligence(settings(), search_provider=FakeSearch(), model_assistant=NullModelAssistant(), client=httpx.Client())
    pipeline.inspector = FakeInspector()
    pipeline.acquirer = AcquireMustNotRun()
    summary = pipeline.run(CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3)), tmp_path, acquire=False)
    assert summary.shortlisted_candidate_ids
    assert (tmp_path / "inspection_summary.json").exists()
    assert (tmp_path / "run_summary.json").exists()
    assert not (tmp_path / "source_manifest.json").exists()
    assert not (tmp_path / "documents").exists()

