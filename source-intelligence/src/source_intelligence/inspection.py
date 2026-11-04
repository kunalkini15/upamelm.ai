from __future__ import annotations

import ipaddress
import re
import socket
from datetime import date
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import unquote, urljoin, urlsplit

import httpx
from pydantic import HttpUrl

try:
    from pypdf import PdfReader
except ImportError:  # Allows request validation and non-PDF tests before optional environment setup.
    PdfReader = None  # type: ignore[assignment]

from .models import Candidate, CityRequest, DateEvidence, SearchResult
from .util import canonical_url, stable_id


ALLOWED_EXTENSIONS = {".pdf", ".csv", ".tsv", ".xlsx", ".xls", ".kml", ".kmz", ".json", ".geojson", ".zip"}
DOCUMENT_TYPES = {
    ".pdf": "application/pdf", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel", ".kml": "application/vnd.google-earth.kml+xml",
    ".kmz": "application/vnd.google-earth.kmz", ".json": "application/json",
    ".geojson": "application/geo+json", ".zip": "application/zip",
}
CATEGORY_KEYWORDS = {
    "aquifer_groundwater": {"aquifer", "groundwater", "hydrogeology", "water level", "recharge"},
    "geology_lithology": {"geology", "geological", "lithology", "stratigraphy", "rock"},
    "soil_land": {"soil", "land use", "land cover", "pedology", "soil resource"},
    "groundwater_quality": {"groundwater quality", "water quality", "contamination", "hydrochemistry", "chemical"},
    "geohazards_urban_subsurface": {"geohazard", "seismic", "earthquake", "subsidence", "flood", "geotechnical", "subsurface"},
}
YEAR_RE = re.compile(r"\b(20[0-3]\d)\b")
RANGE_RE = re.compile(r"\b(20[0-3]\d)\s*(?:-|–|—|to|/)\s*(20[0-3]\d)\b", re.I)
DATE_CONTEXT = re.compile(r".{0,80}(?:published|publication|report|data|monitoring|survey|assessment|year|period).{0,100}", re.I | re.S)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href:
            self.links.append((self._href, " ".join(self._text).strip()))
            self._href = None


def assert_public_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("only public http(s) URLs are allowed")
    host = parts.hostname.lower()
    if host == "localhost" or host.endswith(".local"):
        raise ValueError("local network URLs are not allowed")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parts.port or 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError(f"cannot resolve host: {host}") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("private or non-global network URL is not allowed")


def public_request(client: httpx.Client, method: str, url: str, *, stream: bool = False, max_redirects: int = 5) -> httpx.Response:
    """Follow redirects only after validating every network destination."""
    current = url
    for _ in range(max_redirects + 1):
        assert_public_url(current)
        request = client.build_request(method, current)
        response = client.send(request, stream=stream)
        if response.is_redirect:
            location = response.headers.get("location")
            response.close()
            if not location:
                raise ValueError("redirect response has no location")
            current = urljoin(current, location)
            continue
        assert_public_url(str(response.url))
        return response
    raise ValueError("too many redirects")


def _extension(url: str) -> str:
    path = unquote(urlsplit(url).path.lower())
    return next((ext for ext in ALLOWED_EXTENSIONS if path.endswith(ext)), "")


def _date_evidence(text: str, as_of: date, metadata_date: str | None = None) -> DateEvidence:
    excerpts = [" ".join(match.group(0).split())[:220] for match in DATE_CONTEXT.finditer(text) if YEAR_RE.search(match.group(0))][:8]
    ranges = [(int(a), int(b)) for a, b in RANGE_RE.findall(" ".join(excerpts))]
    publication: date | None = None
    # Transport/upload metadata is retained separately; it is not publication evidence.
    publication_years = [int(value) for value in YEAR_RE.findall(" ".join(x for x in excerpts if re.search(r"publish|report", x, re.I))) if int(value) <= as_of.year]
    if publication_years:
        publication = date(max(y for y in publication_years if y <= as_of.year), 1, 1)
    data_end = max((end for _, end in ranges if end <= as_of.year), default=None)
    data_start = min((start for start, end in ranges if end <= as_of.year), default=None)
    if data_end is None:
        data_years = [int(value) for value in YEAR_RE.findall(" ".join(x for x in excerpts if re.search(r"data|monitor|survey|assessment|period", x, re.I)))]
        data_years = [year for year in data_years if year <= as_of.year]
        data_end = max(data_years, default=None)
        data_start = min(data_years, default=None)
    confidence = 0.85 if ranges else 0.65 if excerpts else 0.35 if publication else 0
    return DateEvidence(
        publication_date=publication,
        data_period_start=date(data_start, 1, 1) if data_start else None,
        data_period_end=date(data_end, 1, 1) if data_end else None,
        basis="document_text" if excerpts else "unknown",
        confidence=confidence,
        excerpts=excerpts,
        publication_date_text=str(publication.year) if publication else None,
        observation_date_texts=[f"{a}-{b}" for a, b in ranges],
        upload_or_modified_date=metadata_date,
        retrieval_date=as_of,
    )


class CandidateInspector:
    def __init__(self, client: httpx.Client, max_probe_bytes: int = 4 * 1024 * 1024):
        self.client = client
        self.max_probe_bytes = max_probe_bytes

    def from_result(self, result: SearchResult) -> Candidate:
        return Candidate(
            candidate_id=stable_id("candidate", result.category.value, canonical_url(str(result.url))),
            category=result.category, title=result.title, landing_url=result.url,
            search_queries=[result.query_id], metadata={"snippet": result.snippet, "search_rank": result.rank},
        )

    def inspect(self, candidate: Candidate, request: CityRequest) -> tuple[Candidate, str]:
        assert_public_url(str(candidate.landing_url))
        response = public_request(self.client, "GET", str(candidate.landing_url), stream=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        target = str(response.url)
        sample = ""
        metadata_date: str | None = response.headers.get("last-modified")
        chunks: list[bytes] = []
        size = 0
        truncated = False
        try:
            for chunk in response.iter_bytes(64 * 1024):
                remaining = self.max_probe_bytes - size
                if remaining <= 0:
                    truncated = True
                    break
                if len(chunk) > remaining:
                    truncated = True
                chunks.append(chunk[:remaining])
                size += min(len(chunk), remaining)
        finally:
            response.close()
        content = b"".join(chunks)
        extension = _extension(target)
        if content.lstrip().startswith(b"%PDF") or content_type == "application/pdf" or extension == ".pdf":
            target, content_type = target, "application/pdf"
            try:
                if truncated:
                    raise RuntimeError("PDF exceeds bounded inspection sample")
                if PdfReader is None:
                    raise RuntimeError("pypdf is not installed")
                reader = PdfReader(BytesIO(content.lstrip()), strict=False)
                candidate.page_count = len(reader.pages)
                page_samples: list[str] = []
                relevant = CATEGORY_KEYWORDS[candidate.category.value]
                indexes = list(dict.fromkeys([0, 1, *range(min(8, len(reader.pages))), max(0, len(reader.pages) - 1)]))
                for index in indexes:
                    text = reader.pages[index].extract_text() or ""
                    if index < 3 or index == len(reader.pages) - 1 or any(term in text.lower() for term in relevant):
                        page_samples.append(f"[page {index + 1}]\n{text}")
                sample = "\n".join(page_samples)
                metadata = reader.metadata or {}
                metadata_date = str(metadata.get("/CreationDate") or metadata.get("/ModDate") or metadata_date or "")
                candidate.title = str(metadata.get("/Title") or candidate.title)
                candidate.publisher = str(metadata.get("/Author") or "") or candidate.publisher
                extracted_chars = len(sample.strip())
                candidate.content_inspection_status = "complete" if extracted_chars >= 500 else "requires_ocr"
                candidate.validation_results.update({
                    "parser_success": True,
                    "page_count": candidate.page_count,
                    "inspected_page_count": len(indexes),
                    "extracted_characters": extracted_chars,
                })
            except Exception as exc:
                # Binary document bytes must never be used as model evidence.
                sample = f"Landing/search evidence only. Title: {candidate.title}. Snippet: {candidate.metadata.get('snippet', '')}"
                candidate.content_inspection_status = "pending_full_download" if truncated else "requires_ocr_or_unsupported"
                candidate.validation_results.update({"parser_success": False, "probe_truncated": truncated, "error": str(exc)})
        elif content_type in {"text/html", "application/xhtml+xml"} or b"<html" in content[:1000].lower():
            html = content.decode(response.encoding or "utf-8", errors="replace")
            parser = LinkParser()
            parser.feed(html)
            links = [(urljoin(target, href), text) for href, text in parser.links
                     if _extension(urljoin(target, href)) or any(term in (href + " " + text).lower() for term in ("download", "report", "annexure", "supplement", "dataset"))]
            if not links:
                raise ValueError("landing page contains no supported downloadable document")
            terms = set((candidate.title + " " + candidate.category.value.replace("_", " ")).lower().split())
            links.sort(key=lambda item: sum(term in (item[0] + " " + item[1]).lower() for term in terms), reverse=True)
            candidate.discovered_asset_urls = [HttpUrl(item[0]) for item in links[:10]]
            target = links[0][0]
            assert_public_url(target)
            extension = _extension(target)
            content_type = DOCUMENT_TYPES.get(extension, "application/octet-stream")
            sample = re.sub(r"<[^>]+>", " ", html)
            candidate.content_inspection_status = "landing_page_only"
        else:
            if extension in {".csv", ".tsv", ".json", ".geojson", ".kml"}:
                sample = content.decode("utf-8", errors="replace")
                candidate.content_inspection_status = "structured_probe"
            else:
                sample = f"Binary asset discovered: {target}. Content inspection pending full download."
                candidate.content_inspection_status = "pending_full_download"
        candidate.download_url = HttpUrl(target)
        candidate.media_type = content_type or DOCUMENT_TYPES.get(_extension(target), "application/octet-stream")
        candidate.content_length = int(response.headers.get("content-length", "0") or 0) or None
        candidate.date_evidence = _date_evidence(f"{candidate.title}\n{candidate.metadata.get('snippet', '')}\n{sample}", request.as_of_date, metadata_date)
        haystack = f"{candidate.title} {candidate.metadata.get('snippet', '')} {sample[:10000]}".lower()
        place_names = [request.city, request.state, *request.district_aliases]
        candidate.geographic_relevance = min(1.0, 0.35 * sum(name.lower() in haystack for name in place_names))
        host = urlsplit(target).hostname or ""
        candidate.authority_score = 1.0 if any(host == domain or host.endswith("." + domain) for domain in request.trusted_domains) else 0.35
        if candidate.publisher and any(name.lower() in candidate.publisher.lower() for name in request.preferred_publishers):
            candidate.authority_score = max(candidate.authority_score, 0.9)
        keywords = CATEGORY_KEYWORDS[candidate.category.value]
        candidate.category_relevance = min(1.0, 0.35 * sum(term in haystack for term in keywords))
        utility_terms = {"map", "table", "survey", "assessment", "monitoring", "aquifer", "geology", "soil", "quality", "data"}
        candidate.scientific_utility = min(1.0, 0.12 * sum(term in haystack for term in utility_terms))
        candidate.inspected = True
        candidate.validation_results.setdefault("inspected_page_count", 1)
        candidate.lifecycle_status = "inspected"
        return candidate, sample[:30000]
