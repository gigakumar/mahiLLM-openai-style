"""Encryption helpers leveraging cryptography + keyring."""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

try:
    import keyring
except Exception:  # pragma: no cover - optional dependency
    keyring = None


class KeyManager:
    """Persist encryption keys using the OS keyring when possible."""

    def __init__(self, service_name: str, storage_dir: Path) -> None:
        self.service_name = service_name
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.file_path = self.storage_dir / "fernet.key"

    def get_key(self) -> bytes:
        if keyring is not None:
            secret = keyring.get_password(self.service_name, "default")
            if secret:
                return secret.encode()
        if self.file_path.exists():
            return self.file_path.read_bytes()
        key = Fernet.generate_key()
        if keyring is not None:
            try:
                keyring.set_password(self.service_name, "default", key.decode())
            except Exception:
                pass
        else:
            self.file_path.write_bytes(key)
        os.chmod(self.file_path, 0o600)
        return key


class Encryptor:
    """Encrypt/decrypt blobs while abstracting key management."""

    def __init__(self, key_manager: KeyManager) -> None:
        self._fernet = Fernet(key_manager.get_key())

    def encrypt(self, data: bytes) -> bytes:
        return self._fernet.encrypt(data)

    def decrypt(self, token: bytes) -> bytes:
        return self._fernet.decrypt(token)

    def encrypt_text(self, text: str) -> str:
        return self.encrypt(text.encode()).decode()

    def decrypt_text(self, token: str) -> str:
        return self.decrypt(token.encode()).decode()
