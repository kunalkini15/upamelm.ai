"""Domain-independent, evidence-first autonomous research engine."""

from .models import ResearchRequest, ResearchResult
from .agent.orchestrator import ResearchOrchestrator

__all__ = ["ResearchRequest", "ResearchResult", "ResearchOrchestrator"]
