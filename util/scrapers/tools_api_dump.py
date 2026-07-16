#!/usr/bin/env python3
"""
Generic per-entity dump from the WalkScape tools API.

For entities where we don't (yet) need to match a specific dataclass
shape, this module pulls /endpoint/ + /endpoint/id/{id} for every item
and emits a Python data module preserving the API's null/empty/missing
distinctions.

Used by the per-entity ingest scripts in util/scrapers/ingest_*_from_tools_api.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

# Ensure repo root on path when run as script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from util.scrapers.tools_api_client import ToolsAPIClient  # noqa: E402
from util.scrapers.tools_api_transform import write_python_data_module  # noqa: E402


def hydrate_endpoint(
    client: ToolsAPIClient,
    endpoint: str,
    *,
    use_cache: bool = True,
    transform: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    skip_predicate: Optional[Callable[[Dict[str, Any]], bool]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Fetch list + detail for every entity. Returns {id: detail_dict}.

    `transform` if supplied is applied to each detail dict.
    `skip_predicate(item)` returns True to skip an item.
    """
    items = client.list(endpoint, use_cache=use_cache)
    out: Dict[str, Dict[str, Any]] = {}
    for item in items:
        eid = item.get('id')
        if not eid:
            continue
        if skip_predicate and skip_predicate(item):
            continue
        try:
            detail = client.get(endpoint, eid, use_cache=use_cache)
        except Exception as e:
            print(f"  [skip] {endpoint}/{eid}: {e}", file=sys.stderr)
            continue
        if transform:
            detail = transform(detail)
        out[eid] = detail
    return out


def dump_endpoint(
    client: ToolsAPIClient,
    endpoint: str,
    out_path: str,
    var_name: str,
    *,
    use_cache: bool = True,
    transform: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    docstring: Optional[str] = None,
) -> int:
    """Hydrate an endpoint and write the result as a Python data module.

    Returns the count of entities written.
    """
    data = hydrate_endpoint(client, endpoint, use_cache=use_cache, transform=transform)
    write_python_data_module(
        out_path,
        var_name,
        data,
        docstring=docstring or f'{endpoint.title()} data from the WalkScape tools API.',
    )
    return len(data)
