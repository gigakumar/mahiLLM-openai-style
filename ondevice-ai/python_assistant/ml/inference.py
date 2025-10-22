"""MLX-backed inference helpers with graceful fallbacks."""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

try:  # Optional MLX runtime
    import mlx.core as mx  # type: ignore
    from mlx_lm import load as load_mlx_model  # type: ignore

    MLX_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    MLX_AVAILABLE = False
    mx = None
    load_mlx_model = None

try:  # Optional sentence-transformers fallback
    from sentence_transformers import SentenceTransformer  # type: ignore

    ST_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    ST_AVAILABLE = False
    SentenceTransformer = None  # type: ignore


class EmbeddingError(RuntimeError):
    """Raised when embeddings cannot be generated."""


class GenerationError(RuntimeError):
    """Raised when text generation fails."""


class ModelManager:
    """Manage MLX / fallback inference backends with caching."""

    def __init__(self, model_id: str, device: str = "metal", **kwargs: Any) -> None:
        self.model_id = model_id
        self.device = device
        self.kwargs = kwargs
        self._mlx_bundle: Optional[Any] = None
        self._st_model: Optional[SentenceTransformer] = None  # type: ignore
        self._dummy: bool = False

    async def ensure_loaded(self) -> None:
        if self._mlx_bundle or self._st_model:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self) -> None:
        if MLX_AVAILABLE:
            try:
                logger.info("Loading MLX model %s", self.model_id)
                self._mlx_bundle = load_mlx_model(self.model_id, device=self.device, **self.kwargs)  # type: ignore[arg-type]
                return
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.warning("Failed to load MLX model %s: %s", self.model_id, exc)
        if ST_AVAILABLE:
            logger.info("Falling back to SentenceTransformer (%s)", self.model_id)
            self._st_model = SentenceTransformer(self.model_id)  # type: ignore[call-arg]
        else:
            logger.warning(
                "No inference backend available. Enabling dummy inference fallback (dev mode)."
            )
            self._dummy = True

    async def embed(self, texts: Iterable[str]) -> List[List[float]]:
        await self.ensure_loaded()
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._embed_sync, list(texts))

    def _embed_sync(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if self._dummy:
            # Simple deterministic embedding: 64-dim bucketed char codes
            dim = 64
            out: List[List[float]] = []
            for t in texts:
                vec = [0.0] * dim
                for i, ch in enumerate(t):
                    vec[i % dim] += (ord(ch) % 31) / 31.0
                # L2 normalize
                norm = sum(v * v for v in vec) ** 0.5 or 1.0
                out.append([v / norm for v in vec])
            return out
        if self._mlx_bundle:
            model, tokenizer = self._mlx_bundle
            vectors: List[List[float]] = []
            for text in texts:
                if hasattr(model, "embed"):
                    vec = model.embed(text)
                else:  # simple encode via tokenizer -> mean pooling
                    tokens = tokenizer.encode(text, return_tensors="np")
                    outputs = model(tokens)
                    vec = outputs.mean(axis=1)
                vectors.append(vec.squeeze().tolist())
            return vectors
        if self._st_model:
            embeddings = self._st_model.encode(texts, convert_to_numpy=True, show_progress_bar=False)  # type: ignore[call-arg]
            return embeddings.tolist()
        raise EmbeddingError("No embedding backend available")

    async def generate(self, prompt: str, **params: Any) -> str:
        await self.ensure_loaded()
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._generate_sync, prompt, params)

    def _generate_sync(self, prompt: str, params: Dict[str, Any]) -> str:
        max_tokens = params.get("max_tokens", 512)
        temperature = params.get("temperature", 0.7)
        if self._dummy:
            # Minimal echo with guidance for dev mode
            return (
                "[dev-fallback] Answering without a local model. "
                "Install mlx-lm (macOS) or sentence-transformers for real outputs.\n\n" 
                f"Prompt: {prompt[:400]}"
            )
        if self._mlx_bundle:
            model, tokenizer = self._mlx_bundle
            generate_func = getattr(model, "generate", None)
            if callable(generate_func):
                output = generate_func(
                    tokenizer,
                    prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    **{k: v for k, v in params.items() if k not in {"max_tokens", "temperature"}},
                )
                return output if isinstance(output, str) else str(output)
            # Manual loop if generate is not available
            tokens = tokenizer.encode(prompt, return_tensors="np")
            outputs = model.generate(tokens, max_tokens=max_tokens, temperature=temperature)
            if hasattr(tokenizer, "decode"):
                return tokenizer.decode(outputs[0])
            return str(outputs)
        if self._st_model:
            # Basic echo for fallback when only embeddings are available
            return f"[fallback] {prompt}"
        raise GenerationError("No generation backend available")


@lru_cache(maxsize=4)
def get_model_manager(model_id: str, device: str = "metal", **kwargs: Any) -> ModelManager:
    manager = ModelManager(model_id=model_id, device=device, **kwargs)
    return manager
