from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional
from doc_intelligence.providers.base import BaseModelProvider, ModelResponse


class MockModelProvider(BaseModelProvider):
    """Deterministic mock provider for offline testing and baseline runs without API keys."""

    def __init__(
        self,
        default_json: Optional[Dict[str, Any]] = None,
        custom_handler: Optional[Callable[[str], Dict[str, Any]]] = None,
    ):
        self._default_json = default_json or {}
        self._custom_handler = custom_handler
        self.call_count = 0
        self.recorded_prompts: List[str] = []

    @property
    def provider_name(self) -> str:
        return "mock"

    def complete(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.0,
    ) -> ModelResponse:
        self.call_count += 1
        self.recorded_prompts.append(prompt)

        if self._custom_handler:
            result_data = self._custom_handler(prompt)
        elif self._default_json:
            result_data = self._default_json
        else:
            result_data = {
                "relevant_pages": [1],
                "findings": [
                    {
                        "finding_id": "mock_f1",
                        "values": {
                            "summary": "Mock extracted observation",
                            "status": "active",
                        },
                        "page_number": 1,
                        "source_text": "Sample verified document context.",
                    }
                ],
            }

        content_str = json.dumps(result_data) if json_mode else str(result_data)

        return ModelResponse(
            content=content_str,
            parsed_json=result_data if json_mode else None,
            prompt_tokens=150,
            completion_tokens=50,
            total_tokens=200,
            model_name="mock-model-v1",
        )
