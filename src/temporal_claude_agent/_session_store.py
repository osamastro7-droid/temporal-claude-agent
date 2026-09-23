"""A SessionStore for the Claude Agent SDK that keeps transcripts in a folder.

Point every worker at the same shared folder (dev), or write an S3 version for
production. Only append() and load() are required by the SDK.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional


class FileSessionStore:
    def __init__(self, root: "str | os.PathLike[str]") -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._seen: dict[Path, set[str]] = {}

    def _path(self, key: dict[str, Any]) -> Path:
        name = f"{key['project_key']}__{key['session_id']}"
        if key.get("subpath"):
            name += "__" + str(key["subpath"])
        return self._root / (re.sub(r"[^A-Za-z0-9_.-]", "_", name)[:240] + ".jsonl")

    def _uuids(self, path: Path) -> set[str]:
        if path not in self._seen:
            found: set[str] = set()
            if path.exists():
                for line in path.read_text().splitlines():
                    if line.strip():
                        uid = json.loads(line).get("uuid")
                        if uid:
                            found.add(uid)
            self._seen[path] = found
        return self._seen[path]

    async def append(self, key: dict[str, Any], entries: list[dict[str, Any]]) -> None:
        path = self._path(key)
        seen = self._uuids(path)
        with path.open("a") as handle:
            for entry in entries:
                uid = entry.get("uuid")
                if uid and uid in seen:
                    continue  # the SDK asks adapters to treat uuid as an idempotency key
                handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
                if uid:
                    seen.add(uid)

    async def load(self, key: dict[str, Any]) -> Optional[list[dict[str, Any]]]:
        path = self._path(key)
        if not path.exists():
            return None
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
