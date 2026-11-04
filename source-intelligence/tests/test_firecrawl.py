import httpx

from source_intelligence.models import Category, SearchQuery
from source_intelligence.search.firecrawl import FirecrawlSearchProvider


def test_firecrawl_retries_rate_limit(monkeypatch) -> None:
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"retry-after": "0"})
        return httpx.Response(200, json={"data": [{"title": "Report", "url": "https://example.com/report.pdf"}]})

    monkeypatch.setattr("source_intelligence.search.firecrawl.time.sleep", lambda _: None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = FirecrawlSearchProvider("key", "https://firecrawl.test/v1", client)
        results = provider.search(SearchQuery(query_id="q1", category=Category.SOIL_LAND, text="query"), 5)
    assert calls == 2
    assert results[0].title == "Report"
