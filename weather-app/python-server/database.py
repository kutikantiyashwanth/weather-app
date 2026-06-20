"""
database.py — TinyDB CRUD operations
Collections: searches, snapshots, locations, range_queries
Stored as JSON files in ../data/
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from tinydb import TinyDB, Query

# ── Data directory ────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Open collections ──────────────────────────────────────────────────────────
_searches_db  = TinyDB(DATA_DIR / "py_searches.json",     indent=2)
_snapshots_db = TinyDB(DATA_DIR / "py_snapshots.json",    indent=2)
_locations_db = TinyDB(DATA_DIR / "py_locations.json",    indent=2)
_range_db     = TinyDB(DATA_DIR / "py_range_queries.json", indent=2)

searches_table  = _searches_db.table("searches")
snapshots_table = _snapshots_db.table("snapshots")
locations_table = _locations_db.table("locations")
range_table     = _range_db.table("range_queries")

Q = Query()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_with_id(doc_id: int, doc: dict) -> dict:
    """Convert TinyDB integer doc_id to string _id for consistent frontend API."""
    return {"_id": str(doc_id), **doc}


# ════════════════════════════════════════════════════════════════
#  SEARCHES
# ════════════════════════════════════════════════════════════════

def create_search(data: dict) -> dict:
    doc = {**data, "createdAt": _now()}
    doc_id = searches_table.insert(doc)
    return _doc_with_id(doc_id, doc)


def get_search_by_id(id_: str) -> Optional[dict]:
    try:
        doc_id = int(id_)
    except ValueError:
        return None
    doc = searches_table.get(doc_id=doc_id)
    return _doc_with_id(doc_id, doc) if doc else None


def get_all_searches(limit: int = 20) -> list[dict]:
    """Return N most recent searches, joined with their snapshot summary."""
    all_docs = [_doc_with_id(d.doc_id, d) for d in searches_table.all()]
    all_docs.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    rows = all_docs[:limit]

    result = []
    for r in rows:
        snap = snapshots_table.get(Q.search_id == r["_id"])
        result.append({
            **r,
            "temp_c":         snap.get("temp_c")         if snap else None,
            "condition":      snap.get("condition")      if snap else None,
            "condition_icon": snap.get("condition_icon") if snap else None,
        })
    return result


def delete_search(id_: str) -> int:
    """Delete a search and its associated snapshot."""
    try:
        doc_id = int(id_)
    except ValueError:
        return 0
    count = searches_table.remove(doc_ids=[doc_id])
    snapshots_table.remove(Q.search_id == id_)
    return len(count)


def find_recent_coord_search(lat: float, lon: float, since: str) -> Optional[dict]:
    """Find a recent search within ~1 km of these coordinates (GPS dedup)."""
    def match(doc):
        return (
            abs(doc.get("lat", 0) - lat) < 0.01 and
            abs(doc.get("lon", 0) - lon) < 0.01 and
            doc.get("createdAt", "") >= since
        )
    results = searches_table.search(match)
    if not results:
        return None
    results.sort(key=lambda d: d.get("createdAt", ""), reverse=True)
    doc = results[0]
    return _doc_with_id(doc.doc_id, doc)


# ════════════════════════════════════════════════════════════════
#  SNAPSHOTS
# ════════════════════════════════════════════════════════════════

def create_snapshot(data: dict) -> dict:
    doc = {**data, "createdAt": _now()}
    doc_id = snapshots_table.insert(doc)
    return _doc_with_id(doc_id, doc)


def get_snapshot_by_search_id(search_id: str) -> Optional[dict]:
    doc = snapshots_table.get(Q.search_id == search_id)
    if not doc:
        return None
    return _doc_with_id(doc.doc_id, doc)


def update_snapshot(search_id: str, data: dict):
    snapshots_table.update(
        {**data, "updatedAt": _now()},
        Q.search_id == search_id,
    )


# ════════════════════════════════════════════════════════════════
#  SAVED LOCATIONS
# ════════════════════════════════════════════════════════════════

def create_location(data: dict) -> dict:
    """Insert a location; raises ValueError (→ 409) if lat/lon already saved."""
    existing = locations_table.get(
        (Q.lat == data["lat"]) & (Q.lon == data["lon"])
    )
    if existing:
        raise ValueError("Location already saved")
    doc = {**data, "createdAt": _now()}
    doc_id = locations_table.insert(doc)
    return _doc_with_id(doc_id, doc)


def get_all_locations() -> list[dict]:
    docs = [_doc_with_id(d.doc_id, d) for d in locations_table.all()]
    docs.sort(key=lambda r: r.get("name", "").lower())
    return docs


def get_location_by_id(id_: str) -> Optional[dict]:
    try:
        doc_id = int(id_)
    except ValueError:
        return None
    doc = locations_table.get(doc_id=doc_id)
    return _doc_with_id(doc_id, doc) if doc else None


def update_location(id_: str, name: str) -> int:
    try:
        doc_id = int(id_)
    except ValueError:
        return 0
    updated = locations_table.update(
        {"name": name, "updatedAt": _now()},
        doc_ids=[doc_id],
    )
    return len(updated)


def delete_location(id_: str) -> int:
    try:
        doc_id = int(id_)
    except ValueError:
        return 0
    removed = locations_table.remove(doc_ids=[doc_id])
    return len(removed)


# ════════════════════════════════════════════════════════════════
#  DATE RANGE QUERIES
# ════════════════════════════════════════════════════════════════

def create_range_query(data: dict) -> dict:
    doc = {**data, "createdAt": _now(), "updatedAt": _now()}
    doc_id = range_table.insert(doc)
    return _doc_with_id(doc_id, doc)


def get_all_range_queries(
    limit: int = 50,
    offset: int = 0,
    city: str = "",
) -> tuple[int, list[dict]]:
    if city:
        docs = range_table.search(
            Q.city.matches(f".*{city}.*", flags=2)
        )
    else:
        docs = range_table.all()

    rows = [_doc_with_id(d.doc_id, d) for d in docs]
    rows.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    total = len(rows)
    return total, rows[offset: offset + limit]


def get_range_query_by_id(id_: str) -> Optional[dict]:
    try:
        doc_id = int(id_)
    except ValueError:
        return None
    doc = range_table.get(doc_id=doc_id)
    return _doc_with_id(doc_id, doc) if doc else None


def update_range_query(id_: str, updates: dict) -> Optional[dict]:
    try:
        doc_id = int(id_)
    except ValueError:
        return None
    updates["updatedAt"] = _now()
    range_table.update(updates, doc_ids=[doc_id])
    return get_range_query_by_id(id_)


def delete_range_query(id_: str) -> int:
    try:
        doc_id = int(id_)
    except ValueError:
        return 0
    removed = range_table.remove(doc_ids=[doc_id])
    return len(removed)
