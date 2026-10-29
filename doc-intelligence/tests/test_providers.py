import pytest
from unittest.mock import MagicMock, patch
import httpx
from doc_intelligence.providers.base import BaseModelProvider
from doc_intelligence.providers.mock_provider import MockModelProvider
from doc_intelligence.providers.openai_provider import OpenAICompatibleProvider
from doc_intelligence.providers.gemini_provider import GeminiProvider
from doc_intelligence.providers.factory import ProviderFactory

def test_mock_provider():
    p = MockModelProvider(default_json={"status": "ok"})
    resp = p.complete("test prompt", json_mode=True)
    assert resp.parsed_json == {"status": "ok"}
    assert resp.total_tokens > 0
    assert p.call_count == 1

def test_provider_factory():
    p_mock = ProviderFactory.create("mock")
    assert isinstance(p_mock, MockModelProvider)

    p_gemini = ProviderFactory.create("gemini", api_key="dummy_gemini_key")
    assert isinstance(p_gemini, GeminiProvider)

    p_openai = ProviderFactory.create("openai", api_key="dummy_openai_key")
    assert isinstance(p_openai, OpenAICompatibleProvider)

def test_openai_provider_mocked_http():
    p = OpenAICompatibleProvider(api_key="sk-fake")
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "choices": [{"message": {"content": '{"summary": "extracted text"}'}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.Client.post", return_value=mock_response):
        resp = p.complete("summarize this", json_mode=True)
        assert resp.parsed_json == {"summary": "extracted text"}
        assert resp.total_tokens == 15

def test_gemini_provider_mocked_http():
    p = GeminiProvider(api_key="fake-gemini-key")
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "candidates": [
            {"content": {"parts": [{"text": '{"result": 42}'}]}}
        ],
        "usageMetadata": {
            "promptTokenCount": 20,
            "candidatesTokenCount": 10,
            "totalTokenCount": 30,
        },
    }
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.Client.post", return_value=mock_response):
        resp = p.complete("calculate answer", json_mode=True)
        assert resp.parsed_json == {"result": 42}
        assert resp.total_tokens == 30
