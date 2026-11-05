from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def not_found(kind: str, identifier: str) -> ApiError:
    return ApiError(404, f"{kind}_not_found", f"{kind.title()} '{identifier}' was not found.")
