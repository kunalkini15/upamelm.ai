from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class ModelResponse(BaseModel):
    content: str
    parsed_json: Optional[Dict[str, Any]] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model_name: str = ""
    raw_response: Optional[Any] = None


class BaseModelProvider(ABC):
    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @abstractmethod
    def complete(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        reasoning_effort: Optional[str] = None,
    ) -> ModelResponse:
        """Synchronous completion."""
        pass
