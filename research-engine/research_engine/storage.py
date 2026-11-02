import os
import uuid
from pathlib import Path
from .models import ResearchState


def save_state(state: ResearchState, path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp.open("x", encoding="utf-8") as stream:
            stream.write(state.model_dump_json(indent=2))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, target)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def load_state(path: str | Path) -> ResearchState:
    return ResearchState.model_validate_json(Path(path).read_text(encoding="utf-8"))
