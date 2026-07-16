#!/usr/bin/env python3
"""
Shared HTTP client for the WalkScape tools API
(https://tools-api-dev.dev.walkscape.app /
 https://tools-api.dev.walkscape.app).

Features:
    - Bearer-token auth, key loaded from (in priority order):
        1. constructor `api_key=` argument
        2. env var WALKSCAPE_TOOLS_API_KEY
        3. file .walkscape_tools_api_key at the repo root
    - Disk cache at util/cache/tools_api_cache/<endpoint>/<id>.json with a
      configurable TTL (default 24h). Cache misses hit the network.
    - Token-bucket rate limiter (default 100 req/min; API limit is 120).
    - Automatic retry with exponential backoff on 429 / 5xx.
    - Dev endpoint by default; prod can be selected via constructor or
      WALKSCAPE_TOOLS_API_BASE env var.

This module is intentionally standalone — no imports from util/* so it can
be reused by any future scraper migration (locations, shops, pets, routes,
activities, …) without circular imports.

Example usage:

    from util.scrapers.tools_api_client import ToolsAPIClient

    client = ToolsAPIClient()
    services = client.list('services')          # [{id, name, icon}, …]
    detail = client.get('services', 'basic_forge')   # full service object

    # Hydrate every service in one call (cached):
    all_detail = list(client.iter_detailed('services'))
"""

from __future__ import annotations

import json
import os
import random
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional
from urllib.parse import quote

import requests


# ────────────────────────────────────────────────────────────────────────
# Repo-root discovery (independent of cwd — climb until we find pyproject
# or the sentinel .walkscape_tools_api_key file)
# ────────────────────────────────────────────────────────────────────────

def _find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for parent in [cur, *cur.parents]:
        if (parent / '.git').exists() or (parent / '.walkscape_tools_api_key').exists():
            return parent
    # Fallback: two levels up from this file (util/scrapers/ → repo root)
    return Path(__file__).resolve().parent.parent.parent


REPO_ROOT = _find_repo_root(Path(__file__))
DEFAULT_KEY_FILE = REPO_ROOT / '.walkscape_tools_api_key'
DEFAULT_CACHE_DIR = REPO_ROOT / 'util' / 'cache' / 'tools_api_cache'

DEV_BASE_URL = 'https://tools-api-dev.dev.walkscape.app'
PROD_BASE_URL = 'https://tools-api.dev.walkscape.app'


# ────────────────────────────────────────────────────────────────────────
# Errors
# ────────────────────────────────────────────────────────────────────────

class ToolsAPIError(RuntimeError):
    """Base error for all tools-api client failures."""


class MissingAPIKeyError(ToolsAPIError):
    """No API key could be located from any source."""


class AuthenticationError(ToolsAPIError):
    """API returned 401/403 — key is invalid or missing permissions."""


class NotFoundError(ToolsAPIError):
    """API returned 404 for the requested resource."""


class RateLimitError(ToolsAPIError):
    """API returned 429 and retries were exhausted."""


# ────────────────────────────────────────────────────────────────────────
# Rate limiter
# ────────────────────────────────────────────────────────────────────────

class _TokenBucket:
    """Simple sliding-window rate limiter, thread-safe.

    Allows up to `max_per_window` requests in any rolling `window_seconds`.
    `acquire()` blocks until a slot is free.
    """

    def __init__(self, max_per_window: int, window_seconds: float):
        self.max_per_window = max_per_window
        self.window_seconds = window_seconds
        self._timestamps: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                # Drop timestamps outside the window
                while self._timestamps and now - self._timestamps[0] > self.window_seconds:
                    self._timestamps.popleft()
                if len(self._timestamps) < self.max_per_window:
                    self._timestamps.append(now)
                    return
                # Need to wait until the oldest timestamp exits the window
                wait_for = self.window_seconds - (now - self._timestamps[0])
            # Release lock while sleeping
            time.sleep(max(wait_for, 0.01))


# ────────────────────────────────────────────────────────────────────────
# Key loader
# ────────────────────────────────────────────────────────────────────────

def _load_api_key(explicit: Optional[str], key_file: Optional[Path]) -> str:
    if explicit:
        return explicit.strip()

    env = os.environ.get('WALKSCAPE_TOOLS_API_KEY')
    if env:
        return env.strip()

    path = key_file or DEFAULT_KEY_FILE
    if path.exists():
        content = path.read_text(encoding='utf-8').strip()
        if content:
            return content

    raise MissingAPIKeyError(
        f"No WalkScape tools-api key found. Provide one via:\n"
        f"  1. ToolsAPIClient(api_key=...)\n"
        f"  2. WALKSCAPE_TOOLS_API_KEY env var\n"
        f"  3. a file at {path}"
    )


# ────────────────────────────────────────────────────────────────────────
# Client
# ────────────────────────────────────────────────────────────────────────

class ToolsAPIClient:
    """HTTP client for the WalkScape tools API.

    Thread-safe; a single instance can be shared across ingest scripts.
    """

    # Endpoints that return a list from the base path.
    LIST_ENDPOINTS = {
        'abilities', 'achievements', 'activities', 'buildings', 'cooldowns',
        'factions', 'global_variables', 'items', 'keywords', 'locations',
        'loot_tables', 'pets', 'recipes', 'rewards', 'routes', 'services',
        'shops', 'skills', 'stats', 'terrain_modifiers',
    }

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        key_file: Optional[Path] = None,
        base_url: Optional[str] = None,
        cache_dir: Optional[Path] = None,
        cache_ttl_seconds: float = 24 * 3600,
        max_requests_per_minute: int = 100,
        max_retries: int = 5,
        timeout_seconds: float = 30.0,
        session: Optional[requests.Session] = None,
    ):
        self.api_key = _load_api_key(api_key, key_file)
        self.base_url = (
            base_url
            or os.environ.get('WALKSCAPE_TOOLS_API_BASE')
            or DEV_BASE_URL
        ).rstrip('/')
        self.cache_dir = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
        self.cache_ttl_seconds = cache_ttl_seconds
        self.max_retries = max_retries
        self.timeout_seconds = timeout_seconds
        self._rate = _TokenBucket(max_requests_per_minute, 60.0)
        self._session = session or requests.Session()
        self._session.headers.update({
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json',
            'User-Agent': 'walkscape-gearset-optimizer/tools-api-client',
        })

    # ── Cache helpers ─────────────────────────────────────────────────

    def _cache_path(self, endpoint: str, key: str) -> Path:
        safe_key = quote(key, safe='')
        return self.cache_dir / endpoint / f'{safe_key}.json'

    def _read_cache(self, path: Path) -> Optional[Any]:
        if not path.exists():
            return None
        if self.cache_ttl_seconds > 0:
            age = time.time() - path.stat().st_mtime
            if age > self.cache_ttl_seconds:
                return None
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            return None

    def _write_cache(self, path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                       encoding='utf-8')
        tmp.replace(path)

    # ── Core fetch ────────────────────────────────────────────────────

    def _request(
        self,
        path: str,
        *,
        method: str = 'GET',
        json_body: Optional[Any] = None,
    ) -> Any:
        """Raw HTTP request with retry & rate limiting — no caching.

        Supports GET (default) and POST. POST bodies are sent as JSON via
        ``json_body``.
        """
        url = f'{self.base_url}{path}'
        for attempt in range(self.max_retries + 1):
            self._rate.acquire()
            try:
                if method == 'POST':
                    resp = self._session.post(
                        url, json=json_body, timeout=self.timeout_seconds
                    )
                else:
                    resp = self._session.get(url, timeout=self.timeout_seconds)
            except requests.RequestException as e:
                if attempt >= self.max_retries:
                    raise ToolsAPIError(f'Network error after retries: {e}')
                time.sleep(self._backoff(attempt))
                continue

            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError as e:
                    raise ToolsAPIError(
                        f'Invalid JSON response from {url}: {e}'
                    )

            if resp.status_code in (401, 403):
                raise AuthenticationError(
                    f'Authentication failed for {url} '
                    f'(HTTP {resp.status_code}): {resp.text[:200]}'
                )
            if resp.status_code == 404:
                raise NotFoundError(f'Not found: {url}')

            # 429 or 5xx → retry
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                if attempt >= self.max_retries:
                    msg = f'{url} failed with HTTP {resp.status_code} after {attempt+1} attempts'
                    if resp.status_code == 429:
                        raise RateLimitError(msg)
                    raise ToolsAPIError(msg)

                # Honour Retry-After if provided
                retry_after = resp.headers.get('Retry-After')
                if retry_after and retry_after.isdigit():
                    time.sleep(float(retry_after))
                else:
                    time.sleep(self._backoff(attempt))
                continue

            # Any other unexpected status
            raise ToolsAPIError(
                f'Unexpected HTTP {resp.status_code} from {url}: '
                f'{resp.text[:200]}'
            )

        # Unreachable — every path above either returns or raises
        raise ToolsAPIError(f'Retry loop exhausted for {url}')

    def _post_request(self, path: str, body: Any) -> Any:
        """Raw HTTP POST with retry & rate limiting — no caching.

        Used for endpoints like /items/ids that take a JSON body.
        """
        url = f'{self.base_url}{path}'
        for attempt in range(self.max_retries + 1):
            self._rate.acquire()
            try:
                resp = self._session.post(
                    url, json=body, timeout=self.timeout_seconds,
                )
            except requests.RequestException as e:
                if attempt >= self.max_retries:
                    raise ToolsAPIError(f'Network error after retries: {e}')
                time.sleep(self._backoff(attempt))
                continue

            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError as e:
                    raise ToolsAPIError(
                        f'Invalid JSON response from {url}: {e}'
                    )

            if resp.status_code in (401, 403):
                raise AuthenticationError(
                    f'Authentication failed for {url} '
                    f'(HTTP {resp.status_code}): {resp.text[:200]}'
                )
            if resp.status_code == 404:
                raise NotFoundError(f'Not found: {url}')

            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                if attempt >= self.max_retries:
                    msg = (
                        f'{url} failed with HTTP {resp.status_code} '
                        f'after {attempt+1} attempts'
                    )
                    if resp.status_code == 429:
                        raise RateLimitError(msg)
                    raise ToolsAPIError(msg)
                retry_after = resp.headers.get('Retry-After')
                if retry_after and retry_after.isdigit():
                    time.sleep(float(retry_after))
                else:
                    time.sleep(self._backoff(attempt))
                continue

            raise ToolsAPIError(
                f'Unexpected HTTP {resp.status_code} from {url}: '
                f'{resp.text[:200]}'
            )
        raise ToolsAPIError(f'Retry loop exhausted for {url}')

    def _backoff(self, attempt: int) -> float:
        # 0.5, 1, 2, 4, 8 … with jitter
        return min(0.5 * (2 ** attempt), 15.0) * (1.0 + 0.1 * random.random())

    # ── Public API ────────────────────────────────────────────────────

    def list(self, endpoint: str, *, use_cache: bool = True) -> List[Dict[str, Any]]:
        """GET /{endpoint}/ — minimal-shape list of all entities.

        Returns a list of dicts. Caches the raw response to disk.
        """
        self._validate_endpoint(endpoint)
        cache_path = self._cache_path(endpoint, '_list')
        if use_cache:
            cached = self._read_cache(cache_path)
            if cached is not None:
                return cached
        data = self._request(f'/{endpoint}/')
        if not isinstance(data, list):
            raise ToolsAPIError(
                f'Expected list from /{endpoint}/, got {type(data).__name__}'
            )
        self._write_cache(cache_path, data)
        return data

    def get(
        self,
        endpoint: str,
        entity_id: str,
        *,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """GET /{endpoint}/id/{entity_id} — full detail for one entity."""
        self._validate_endpoint(endpoint)
        if not entity_id:
            raise ValueError('entity_id is required')
        cache_path = self._cache_path(endpoint, entity_id)
        if use_cache:
            cached = self._read_cache(cache_path)
            if cached is not None:
                return cached
        data = self._request(f'/{endpoint}/id/{quote(entity_id, safe="")}')
        if not isinstance(data, dict):
            raise ToolsAPIError(
                f'Expected dict from /{endpoint}/id/{entity_id}, '
                f'got {type(data).__name__}'
            )
        self._write_cache(cache_path, data)
        return data

    def iter_detailed(
        self,
        endpoint: str,
        *,
        use_cache: bool = True,
    ) -> Iterator[Dict[str, Any]]:
        """List every entity, then hydrate full detail for each.

        Yields dicts in list order.
        """
        items = self.list(endpoint, use_cache=use_cache)
        for item in items:
            eid = item.get('id')
            if not eid:
                continue
            yield self.get(endpoint, eid, use_cache=use_cache)

    def resolve_ids(
        self,
        ids: Iterable[str],
        *,
        target: str = 'base',
    ) -> Dict[str, str]:
        """POST /items/ids — resolve item slugs to their real game UUIDs.

        Sends ``{"ids": [...], "target": target}`` and returns the API's
        ``{slug: uuid}`` mapping. Slugs the API can't resolve are simply
        absent from the returned dict (the caller decides how to report them).

        ``target`` selects the UUID form ("base" is the tools-api default;
        "old" is also accepted). Not cached — always hits the network.
        """
        id_list = [str(i) for i in ids]
        if not id_list:
            return {}
        data = self._request(
            '/items/ids',
            method='POST',
            json_body={'ids': id_list, 'target': target},
        )
        if not isinstance(data, dict):
            raise ToolsAPIError(
                f'Expected dict from /items/ids, got {type(data).__name__}'
            )
        return data

    def clear_cache(self, endpoint: Optional[str] = None) -> int:
        """Delete cached JSON. Returns count of files removed."""
        target = self.cache_dir / endpoint if endpoint else self.cache_dir
        if not target.exists():
            return 0
        count = 0
        for path in target.rglob('*.json'):
            path.unlink()
            count += 1
        return count

    # ── Internal-ID lookup (POST /items/ids) ───────────────────────────

    def lookup_internal_ids(
        self,
        ids: List[str],
        *,
        target: str = 'base',
        batch_size: int = 1000,
    ) -> Dict[str, str]:
        """Resolve API item ids to their internal ids via POST /items/ids.

        The endpoint accepts a list of API ids and returns a dict mapping
        each id to its internal id (a UUID string, optionally prefixed
        with `item-<api_id>-`). Some special items return a non-UUID
        string (e.g. `camelEgg`). Unknown ids are echoed back unchanged.

        Args:
            ids: API item ids to look up. Sent in batches of `batch_size`.
            target: Lookup target (`'base'` or `'fine'`). Defaults to
                `'base'` which returns the canonical internal id.
            batch_size: Max ids per request. The endpoint handles 866 in
                a single call so this is a generous cap.

        Returns:
            Dict[api_id -> internal_id]. Cache result yourself; this
            method does NOT write to disk.
        """
        out: Dict[str, str] = {}
        # Dedup while preserving order (chunking is order-insensitive
        # but the dedup matters for callers feeding in nested lists).
        seen = set()
        unique: List[str] = []
        for i in ids:
            if i and i not in seen:
                seen.add(i)
                unique.append(i)
        for start in range(0, len(unique), batch_size):
            chunk = unique[start:start + batch_size]
            data = self._post_request(
                '/items/ids',
                {'ids': chunk, 'target': target},
            )
            if not isinstance(data, dict):
                raise ToolsAPIError(
                    f'Expected dict from /items/ids, got {type(data).__name__}'
                )
            out.update(data)
        return out

    # ── Internal validation ────────────────────────────────────────────

    def _validate_endpoint(self, endpoint: str) -> None:
        if endpoint not in self.LIST_ENDPOINTS:
            raise ValueError(
                f'Unknown endpoint {endpoint!r}. '
                f'Allowed: {sorted(self.LIST_ENDPOINTS)}'
            )
