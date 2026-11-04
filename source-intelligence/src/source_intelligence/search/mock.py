from __future__ import annotations

from ..models import SearchQuery, SearchResult


class MockSearchProvider:
    name = "mock"

    def __init__(self, fixtures: dict[str, list[dict]] | None = None):
        self.fixtures = fixtures or {}

    def search(self, query: SearchQuery, limit: int) -> list[SearchResult]:
        return [SearchResult(query_id=query.query_id, category=query.category, provider=self.name, rank=index, **item)
                for index, item in enumerate(self.fixtures.get(query.query_id, [])[:limit], 1)]

