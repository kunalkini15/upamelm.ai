from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict
from pydantic import BaseModel


class ArtifactWriter:
    @staticmethod
    def write_json(data: BaseModel | Dict[str, Any], output_path: Path | str) -> Path:
        out = Path(output_path).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(data, BaseModel):
            payload = data.model_dump(mode="json")
        else:
            payload = data

        with open(out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

        return out
