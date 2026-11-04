import json
from datetime import date

import httpx

from source_intelligence.models import Candidate, Category, CityRequest
from source_intelligence.providers.model import OpenAICompatibleAssistant


def candidate() -> Candidate:
    return Candidate(candidate_id="c1", category=Category.SOIL_LAND, title="Soil report", landing_url="https://example.com/report.pdf")


def test_chat_completions_model_adapter() -> None:
    payload = {"publisher": "Government", "publication_date": "2026-01-01", "data_period_start": None,
               "data_period_end": "2025-12-31", "geographic_relevance": 1, "scientific_utility": 0.8,
               "date_excerpts": ["survey data 2025"], "document_type": "report", "document_suitability": True}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}))
    with httpx.Client(transport=transport) as client:
        provider = OpenAICompatibleAssistant("key", "https://model.test/v1", "model", client)
        assert provider.enrich_candidate(CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 1, 1)), candidate(), "survey data 2025") == payload


def test_responses_model_adapter() -> None:
    payload = {"publisher": None, "publication_date": None, "data_period_start": None, "data_period_end": None,
               "geographic_relevance": 0.5, "scientific_utility": 0.5, "date_excerpts": [],
               "document_type": "other", "document_suitability": False}
    raw = {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload)}]}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=raw))
    with httpx.Client(transport=transport) as client:
        provider = OpenAICompatibleAssistant("key", "https://api.meta.ai/v1", "model", client, "responses")
        assert provider.enrich_candidate(CityRequest(city="Bengaluru", state="Karnataka"), candidate(), "sample") == payload
