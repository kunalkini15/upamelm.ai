from __future__ import annotations

from typing import Dict, Optional, Type
from doc_intelligence.parsers.base import BaseParser
from doc_intelligence.parsers.pymupdf_parser import PyMuPDFParser
from doc_intelligence.parsers.docling_parser import DoclingParser
from doc_intelligence.parsers.llamaparse_parser import LlamaParseParser


class ParserRegistry:
    _parsers: Dict[str, Type[BaseParser]] = {
        "pymupdf": PyMuPDFParser,
        "docling": DoclingParser,
        "llamaparse": LlamaParseParser,
    }

    @classmethod
    def register(cls, name: str, parser_cls: Type[BaseParser]) -> None:
        cls._parsers[name.lower()] = parser_cls

    @classmethod
    def get(cls, name: str = "pymupdf", **kwargs) -> BaseParser:
        key = name.lower()
        if key not in cls._parsers:
            available = ", ".join(cls._parsers.keys())
            raise ValueError(f"Unknown parser '{name}'. Available parsers: {available}")
        return cls._parsers[key](**kwargs)

    @classmethod
    def list_available(cls) -> list[str]:
        return list(cls._parsers.keys())
