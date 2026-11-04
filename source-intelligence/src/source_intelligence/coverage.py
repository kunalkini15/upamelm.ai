from __future__ import annotations

from .models import Category, CityRequest, CoveragePlan, SearchQuery
from .util import stable_id


TERMS: dict[Category, list[str]] = {
    Category.AQUIFER_GROUNDWATER: [
        "groundwater monitoring aquifer mapping fracture zones",
        "borehole logs water level observation wells",
    ],
    Category.GEOLOGY_LITHOLOGY: [
        "borehole logs lithology rockhead depth to rock",
        "geological map subsurface investigation",
    ],
    Category.SOIL_LAND: [
        "soil survey pedon horizon depth soil mapping units",
        "geotechnical soil investigation bore logs",
    ],
    Category.GROUNDWATER_QUALITY: [
        "groundwater quality monitoring laboratory results",
        "hydrochemistry observation wells dataset",
    ],
    Category.GEOHAZARDS_URBAN_SUBSURFACE: [
        "InSAR subsidence vertical land motion",
        "utility alignment longitudinal section invert levels",
    ],
}


class CoveragePlanner:
    def plan(self, request: CityRequest) -> CoveragePlan:
        city_places = list(dict.fromkeys([request.city, *request.city_aliases, *request.local_language_names]))
        queries: list[SearchQuery] = []
        for category in request.categories:
            for index, term in enumerate(TERMS[category]):
                place = city_places[index % len(city_places)]
                strategies = [
                    (f'"{place}" {request.state} {term}', "broad measurement-specific discovery"),
                    (f'"{place}" {term} site:gov.in', "official agency or repository"),
                    (f'"{place}" {term} after:{request.as_of_date.year - 3}-01-01', "recent source"),
                    (f'"{place}" {term} dataset annexure supplementary', "dataset and companion assets"),
                ]
                # One complementary strategy per term keeps the deterministic plan bounded.
                text, rationale = strategies[index % len(strategies)]
                queries.append(SearchQuery(query_id=stable_id("qry", category.value, text), category=category, text=text, rationale=rationale))
            if request.district_aliases:
                district = request.district_aliases[0]
                text = f'"{district}" district {TERMS[category][0]} repository annexure'
                queries.append(SearchQuery(query_id=stable_id("qry", category.value, text), category=category, text=text,
                                           rationale="district-scoped evidence; district footprint must be qualified separately from city scope"))
            for text in request.extra_queries.get(category, []):
                queries.append(SearchQuery(query_id=stable_id("qry", category.value, text), category=category, text=text, rationale="Caller-supplied query"))
        return CoveragePlan(city=request.city, as_of_date=request.as_of_date, queries=queries)
