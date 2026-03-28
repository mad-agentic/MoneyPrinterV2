import ollama

from config import get_ollama_base_url, get_ollama_model

_selected_model: str | None = None


def _resolve_model_name(requested_model: str | None, available_models: list[str]) -> str | None:
    """Resolve requested model against installed Ollama models.

    Supports exact match, adding ':latest', and prefix-family match.
    """
    name = (requested_model or "").strip()
    if not name or not available_models:
        return None

    # 1) Exact match first.
    if name in available_models:
        return name

    # 2) Common shorthand: llama3.2 -> llama3.2:latest
    with_latest = f"{name}:latest"
    if with_latest in available_models:
        return with_latest

    # 3) Family/prefix match (prefer shortest => usually latest tag).
    prefix = f"{name}:"
    family = sorted([m for m in available_models if m.startswith(prefix)], key=len)
    if family:
        return family[0]

    return None


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
        models = list_models()
        resolved = _resolve_model_name(model_name, models)
        _selected_model = resolved or model_name
        return _selected_model

    if _selected_model:
        return _selected_model

    models = list_models()

    configured_model = (get_ollama_model() or "").strip()
    if configured_model:
        resolved = _resolve_model_name(configured_model, models)
        _selected_model = resolved or configured_model
        return _selected_model

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

    try:
        response = _client().chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        message = str(exc).lower()
        if "not found" in message or "status code: 404" in message:
            # Retry once with a resolved installed model.
            models = list_models()
            fallback = _resolve_model_name(model, models)
            if fallback and fallback != model:
                select_model(fallback)
                response = _client().chat(
                    model=fallback,
                    messages=[{"role": "user", "content": prompt}],
                )
            else:
                raise RuntimeError(
                    f"Ollama model '{model}' not found. Available models: {', '.join(models) if models else 'none'}."
                ) from exc
        else:
            raise

    return response["message"]["content"].strip()
