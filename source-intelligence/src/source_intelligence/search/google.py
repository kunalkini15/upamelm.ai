from __future__ import annotations

import httpx

from ..models import SearchQuery, SearchResult


class GoogleSearchProvider:
    name = "google"

    def __init__(self, api_key: str, engine_id: str, client: httpx.Client):
        self.api_key = api_key
        self.engine_id = engine_id
        self.client = client

    def search(self, query: SearchQuery, limit: int) -> list[SearchResult]:
        results: list[SearchResult] = []
        start = 1
        while len(results) < limit and start <= 91:
            count = min(10, limit - len(results))
            response = self.client.get(
                "https://customsearch.googleapis.com/customsearch/v1",
                params={"key": self.api_key, "cx": self.engine_id, "q": query.text, "num": count, "start": start},
            )
            response.raise_for_status()
            items = response.json().get("items", [])
            for item in items:
                results.append(SearchResult(
                    query_id=query.query_id, category=query.category, title=item.get("title") or "Untitled",
                    url=item["link"], snippet=item.get("snippet", ""), displayed_url=item.get("displayLink"),
                    provider=self.name, rank=len(results) + 1, metadata={"mime": item.get("mime")},
                ))
            if len(items) < count:
                break
            start += count
        return results

