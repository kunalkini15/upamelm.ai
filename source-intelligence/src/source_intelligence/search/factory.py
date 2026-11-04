from __future__ import annotations

import httpx

from ..config import Settings
from .base import SearchProvider
from .firecrawl import FirecrawlSearchProvider
from .google import GoogleSearchProvider
from .mock import MockSearchProvider
from .serper import SerperSearchProvider


def create_search_provider(settings: Settings, client: httpx.Client) -> SearchProvider:
    if settings.search_provider == "google":
        if not settings.google_api_key or not settings.google_engine_id:
            raise ValueError("google search requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID")
        return GoogleSearchProvider(settings.google_api_key, settings.google_engine_id, client)
    if settings.search_provider == "firecrawl":
        if not settings.firecrawl_api_key:
            raise ValueError("firecrawl search requires FIRECRAWL_API_KEY")
        return FirecrawlSearchProvider(settings.firecrawl_api_key, settings.firecrawl_base_url, client)
    if settings.search_provider == "serper":
        if not settings.serper_api_key:
            raise ValueError("serper search requires SERPER_API_KEY")
        return SerperSearchProvider(
            settings.serper_api_key, settings.serper_base_url,
            settings.serper_gl, settings.serper_hl, client,
        )
    if settings.search_provider == "mock":
        return MockSearchProvider()
    raise ValueError(f"unsupported SOURCE_SEARCH_PROVIDER: {settings.search_provider}")

