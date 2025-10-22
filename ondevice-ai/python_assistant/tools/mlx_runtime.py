"""Standalone MLX runtime exposing embed/predict endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    import mlx.core as mx  # type: ignore
    from mlx_lm import load as load_model  # type: ignore
except Exception as exc:  # pragma: no cover
    raise RuntimeError("mlx and mlx-lm must be installed for this runtime") from exc

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="MLX Runtime")
model, tokenizer = load_model("mlx-community/Meta-Llama-3-8B-Instruct", device="metal")


class EmbedPayload(BaseModel):
    texts: List[str]


class PredictPayload(BaseModel):
    prompt: str
    params: Dict[str, Any] | None = None


@app.post("/embed")
async def embed(payload: EmbedPayload) -> Dict[str, Any]:
    vectors: List[List[float]] = []
    for text in payload.texts:
        if hasattr(model, "embed"):
            vec = model.embed(text)
        else:
            tokens = tokenizer.encode(text, return_tensors="np")
            outputs = model(tokens)
            vec = outputs.mean(axis=1)
        vectors.append(vec.squeeze().tolist())
    return {"vectors": vectors}


@app.post("/predict")
async def predict(payload: PredictPayload) -> Dict[str, Any]:
    params = payload.params or {}
    max_tokens = params.get("max_tokens", 256)
    temperature = params.get("temperature", 0.7)
    if hasattr(model, "generate"):
        output = model.generate(
            tokenizer,
            payload.prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text = output if isinstance(output, str) else str(output)
    else:
        tokens = tokenizer.encode(payload.prompt, return_tensors="np")
        outputs = model.generate(tokens, max_tokens=max_tokens, temperature=temperature)
        text = tokenizer.decode(outputs[0]) if hasattr(tokenizer, "decode") else str(outputs)
    return {"text": text}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=9000)
