from __future__ import annotations

from typing import Protocol

from ..models import SearchQuery, SearchResult


class SearchProvider(Protocol):
    name: str

    def search(self, query: SearchQuery, limit: int) -> list[SearchResult]: ...

