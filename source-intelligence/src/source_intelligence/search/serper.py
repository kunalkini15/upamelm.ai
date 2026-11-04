from __future__ import annotations

import time
import logging
from pathlib import Path

import httpx

from ..models import SearchQuery, SearchResult
from ..util import write_json

LOGGER = logging.getLogger(__name__)


class SerperSearchProvider:
    """Google organic results through Serper; no generative model is involved."""

    name = "serper"

    def __init__(self, api_key: str, base_url: str, gl: str, hl: str, client: httpx.Client):
        self.client = client
        self.url = f"{base_url}/search"
        self.headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
        self.gl = gl
        self.hl = hl
        self.audit_root: Path | None = None
        self.last_attempt_count = 0

    def set_audit_root(self, root: Path) -> None:
        self.audit_root = root
        root.mkdir(parents=True, exist_ok=True)

    def search(self, query: SearchQuery, limit: int) -> list[SearchResult]:
        response: httpx.Response | None = None
        request_payload = {"q": query.text, "num": limit, "gl": self.gl, "hl": self.hl}
        if self.audit_root:
            write_json(self.audit_root / query.query_id / "request.json", {"endpoint": self.url, "payload": request_payload})
        for attempt in range(5):
            self.last_attempt_count = attempt + 1
            response = self.client.post(
                self.url,
                headers=self.headers,
                json=request_payload,
            )
            if response.status_code != 429 and response.status_code < 500:
                break
            if attempt == 4:
                break
            retry_after = response.headers.get("retry-after")
            delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else min(8, 2 ** attempt)
            LOGGER.warning("Serper retry %d/4 for query %s after HTTP %d; waiting %.1fs", attempt + 1, query.query_id, response.status_code, max(0.5, min(delay, 15)))
            time.sleep(max(0.5, min(delay, 15)))
        assert response is not None
        response.raise_for_status()
        payload = response.json()
        if self.audit_root:
            write_json(self.audit_root / query.query_id / "response.json", payload)
        items = payload.get("organic", [])
        results: list[SearchResult] = []
        for fallback_rank, item in enumerate(items[:limit], 1):
            url = item.get("link")
            if not url:
                continue
            results.append(SearchResult(
                query_id=query.query_id,
                category=query.category,
                title=item.get("title") or "Untitled",
                url=url,
                snippet=item.get("snippet") or "",
                displayed_url=item.get("displayedLink") or item.get("link"),
                provider=self.name,
                rank=int(item.get("position") or fallback_rank),
                metadata={
                    "date": item.get("date"),
                    "attributes": item.get("attributes"),
                    "sitelinks": item.get("sitelinks"),
                },
            ))
        return results
