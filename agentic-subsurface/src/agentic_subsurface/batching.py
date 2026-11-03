from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .models import ContentUnit, SourceBundle


def approximate_tokens(text: str) -> int:
    """Conservative local fallback; live execution uses Meta's exact counter."""
    return max(1, (len(text) + 2) // 3)


@dataclass
class EvidenceBatch:
    batch_id: str
    units: list[ContentUnit] = field(default_factory=list)
    estimated_tokens: int = 0
    visual_artifact_ids: list[str] = field(default_factory=list)

    def model_text(self) -> str:
        parts = []
        for unit in self.units:
            parts.append(f"\n--- SOURCE UNIT {unit.unit_id} ---\nLOCATOR: {unit.locator.model_dump_json(exclude_none=True)}\n{unit.text}")
        return "".join(parts)


class SemanticBatcher:
    """Lossless, unit-aware batching; never splits a native unit unless unavoidable."""

    def __init__(self, target_tokens: int = 180_000, max_tokens: int = 250_000, max_images: int = 20, token_estimator: Callable[[str], int] = approximate_tokens):
        self.target_tokens = target_tokens
        self.max_tokens = max_tokens
        self.max_images = max_images
        self.token_estimator = token_estimator

    def build(self, bundles: list[SourceBundle]) -> list[EvidenceBatch]:
        batches: list[EvidenceBatch] = []
        current = EvidenceBatch(batch_id="batch-0001")
        for bundle in bundles:
            for unit in bundle.units:
                tokens = self.token_estimator(unit.text) + 80
                would_exceed = current.units and current.estimated_tokens + tokens > self.target_tokens
                if would_exceed:
                    batches.append(current)
                    current = EvidenceBatch(batch_id=f"batch-{len(batches) + 1:04d}")
                current.units.append(unit)
                current.estimated_tokens += tokens
                for aid in unit.artifact_refs:
                    if aid not in current.visual_artifact_ids and len(current.visual_artifact_ids) < self.max_images:
                        current.visual_artifact_ids.append(aid)
                if current.estimated_tokens >= self.max_tokens:
                    batches.append(current)
                    current = EvidenceBatch(batch_id=f"batch-{len(batches) + 1:04d}")
        if current.units:
            batches.append(current)
        return batches

