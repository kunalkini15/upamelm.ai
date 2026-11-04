from source_intelligence.config import load_env_file


def test_env_file_loads_values_without_overriding_environment(tmp_path, monkeypatch) -> None:
    env = tmp_path / ".env"
    env.write_text("SOURCE_SEARCH_PROVIDER=firecrawl\nMODEL_NAME='muse-spark-1.3-contributor'\n", encoding="utf-8")
    monkeypatch.setenv("SOURCE_SEARCH_PROVIDER", "google")
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert load_env_file(env) == env
    assert __import__("os").environ["SOURCE_SEARCH_PROVIDER"] == "google"
    assert __import__("os").environ["MODEL_NAME"] == "muse-spark-1.3-contributor"
