from __future__ import annotations

import os

import uvicorn


def main() -> None:
    port = int(os.getenv("SUBSURFACE_API_PORT", "8010"))
    uvicorn.run("subsurface_api.main:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
