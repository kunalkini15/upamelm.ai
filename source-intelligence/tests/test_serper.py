import httpx

from source_intelligence.models import Category, SearchQuery
from source_intelligence.search.serper import SerperSearchProvider


def test_serper_maps_organic_google_results() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["key"] = request.headers.get("x-api-key")
        captured["body"] = request.content
        return httpx.Response(200, json={"organic": [{
            "title": "Karnataka groundwater assessment",
            "link": "https://example.gov.in/report.pdf",
            "snippet": "Dynamic groundwater resources 2025",
            "date": "May 1, 2026",
            "position": 2,
        }]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = SerperSearchProvider("secret", "https://google.serper.dev", "in", "en", client)
        results = provider.search(SearchQuery(
            query_id="q1", category=Category.AQUIFER_GROUNDWATER, text="Bengaluru groundwater PDF",
        ), 10)
    assert captured["key"] == "secret"
    assert b'"gl":"in"' in captured["body"]
    assert results[0].provider == "serper"
    assert results[0].rank == 2
    assert results[0].metadata["date"] == "May 1, 2026"


def test_serper_retries_rate_limit(monkeypatch) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429 if calls == 1 else 200, json={"organic": []})

    monkeypatch.setattr("source_intelligence.search.serper.time.sleep", lambda _: None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = SerperSearchProvider("secret", "https://google.serper.dev", "in", "en", client)
        provider.search(SearchQuery(query_id="q1", category=Category.SOIL_LAND, text="soil"), 10)
    assert calls == 2
