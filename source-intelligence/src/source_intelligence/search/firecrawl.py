from __future__ import annotations

import time
import logging

import httpx

from ..models import SearchQuery, SearchResult

LOGGER = logging.getLogger(__name__)


class FirecrawlSearchProvider:
    name = "firecrawl"

    def __init__(self, api_key: str, base_url: str, client: httpx.Client):
        self.client = client
        self.url = f"{base_url}/search"
        self.headers = {"Authorization": f"Bearer {api_key}"}
        self.last_attempt_count = 0

    def search(self, query: SearchQuery, limit: int) -> list[SearchResult]:
        response: httpx.Response | None = None
        for attempt in range(5):
            self.last_attempt_count = attempt + 1
            response = self.client.post(self.url, headers=self.headers, json={"query": query.text, "limit": limit})
            if response.status_code != 429 and response.status_code < 500:
                break
            if attempt == 4:
                break
            retry_after = response.headers.get("retry-after")
            delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else min(8, 2 ** attempt)
            LOGGER.warning("Firecrawl retry %d/4 for query %s after HTTP %d; waiting %.1fs", attempt + 1, query.query_id, response.status_code, max(0.5, min(delay, 15)))
            time.sleep(max(0.5, min(delay, 15)))
        assert response is not None
        response.raise_for_status()
        payload = response.json()
        items = payload.get("data", payload.get("results", []))
        return [SearchResult(
            query_id=query.query_id, category=query.category, title=item.get("title") or "Untitled",
            url=item.get("url") or item.get("link"), snippet=item.get("description") or item.get("snippet") or "",
            displayed_url=item.get("url"), provider=self.name, rank=index,
            metadata={key: value for key, value in item.items() if key not in {"title", "url", "link", "description", "snippet"}},
        ) for index, item in enumerate(items[:limit], 1) if item.get("url") or item.get("link")]

