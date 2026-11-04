from datetime import date

from source_intelligence.coverage import CoveragePlanner
from source_intelligence.models import Category, CityRequest


def test_planner_creates_queries_for_every_category() -> None:
    request = CityRequest(city="Bengaluru", state="Karnataka", district_aliases=["Bangalore Urban"], as_of_date=date(2026, 11, 3))
    plan = CoveragePlanner().plan(request)
    assert {query.category for query in plan.queries} == set(Category)
    assert all("Bengaluru" in query.text or "Bangalore Urban" in query.text for query in plan.queries)
    assert any("Bengaluru" in query.text for query in plan.queries)
    assert any("Bangalore Urban" in query.text for query in plan.queries)

