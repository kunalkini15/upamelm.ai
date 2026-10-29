from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional
from doc_intelligence.models.task import TaskSpecification


class TaskLoader:
    @staticmethod
    def from_dict(data: Dict[str, Any]) -> TaskSpecification:
        return TaskSpecification(**data)

    @staticmethod
    def from_json_file(file_path: Path | str) -> TaskSpecification:
        path = Path(file_path).resolve()
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return TaskSpecification(**data)
