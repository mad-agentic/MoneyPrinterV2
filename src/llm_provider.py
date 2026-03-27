import ollama

from config import get_ollama_base_url, get_ollama_model

_selected_model: str | None = None


def _client() -> ollama.Client:
    return ollama.Client(host=get_ollama_base_url())


def list_models() -> list[str]:
    """
    Lists all models available on the local Ollama server.

    Returns:
        models (list[str]): Sorted list of model names.
    """
    response = _client().list()
    return sorted(m.model for m in response.models if m.model)


def select_model(model: str) -> None:
    """
    Sets the model to use for all subsequent generate_text calls.

    Args:
        model (str): An Ollama model name (must be already pulled).
    """
    global _selected_model
    _selected_model = model


def get_active_model() -> str | None:
    """
    Returns the currently selected model, or None if none has been selected.
    """
    return _selected_model


def ensure_model_selected(model_name: str | None = None) -> str:
    """
    Resolve the active Ollama model.

    Priority:
    1. Explicit function argument
    2. Previously selected in-memory model
    3. `ollama_model` from config.json
    4. First available local Ollama model
    """
    global _selected_model

    if model_name:
        _selected_model = model_name
        return model_name

    if _selected_model:
        return _selected_model

    configured_model = (get_ollama_model() or "").strip()
    if configured_model:
        _selected_model = configured_model
        return configured_model

    models = list_models()
    if models:
        _selected_model = models[0]
        return _selected_model

    raise RuntimeError(
        "No Ollama model available. Set 'ollama_model' in config.json or pull a model first, "
        "for example: ollama pull llama3.2:3b"
    )


def generate_text(prompt: str, model_name: str | None = None) -> str:
    """
    Generates text using the local Ollama server.

    Args:
        prompt (str): User prompt
        model_name (str): Optional model name override

    Returns:
        response (str): Generated text
    """
    model = ensure_model_selected(model_name)

    response = _client().chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )

    return response["message"]["content"].strip()
