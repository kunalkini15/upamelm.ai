"""Standalone document discovery and acquisition for city studies."""

from .models import CityRequest, SourceManifest
from .orchestrator import SourceIntelligence

__all__ = ["CityRequest", "SourceIntelligence", "SourceManifest"]
__version__ = "0.1.0"

