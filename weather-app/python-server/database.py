"""
database.py — TinyDB NoSQL database layer
Collections: searches, snapshots, saved_locations, range_queries
"""

import os
from pathlib import Path
from datetime import datetime, timezone
from tinydb import TinyDB, Query
from tinydb.storages import JSONStorage
from tinydb.middlewares import CachingMiddleware

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ── Open databases ─────────────────────────────────────────────────────────────

_searches_db   = TinyDB(DATA_DIR / "py_searches.json",   storage=CachingMiddleware(JSONStorage))
_snapshots_db  = TinyDB(DATA_DIR / "py_snapshots.json",  storage=CachingMiddleware(JSONStorage))
_locations_db  = TinyDB(DATA_DIR / "py_locations.json",  storage=CachingMiddleware(JSONStorage))
_range_db      = TinyDB(DATA_DIR / "py_range_queries.json", storage=CachingMiddleware(JSONStorage))

searches_table  = _searches_db.table("searches")
snapshots_table = _snapshots_db.table("snapshots")
locations_table = _locations_db.table("locations")
range_table     = _range_db.table("range_queries")

Q = Query()

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _doc_with_id(doc_id: int, doc: dict) -> dict:
    """Attach TinyDB doc_id as string _id field."""
    return {"_id": str(doc_id), **doc}

# ══════════════════════════════════════════════════════════════════════════════
# SEARCHES  (CREATE / READ / DELETE)
# ══════════════════════════════════════════════════════════════════════════════

def create_search(data: dict) -> dict:
    data["createdAt"] = _now()
    doc_id = searches_table.insert(data)
    return _doc_with_id(doc_id, data)


def get_all_searches(limit: int = 20) -> list:
    all_docs = searches_table.all()
    # Sort by createdAt descending, take limit
    sorted_docs = sorted(all_docs, key=lambda d: d.get("createdAt", ""), reverse=True)[:limit]

    # Join with snapshots
    result = []
    for doc in sorted_docs:
        doc_id = str(doc.doc_id)
        snap = snapshots_table.get(Q.search_id == doc_id)
        row = _doc_with_id(doc.doc_id, dict(doc))
        row["temp_c"]         = snap.get("temp_c")         if snap else None
        row["condition"]      = snap.get("condition")      if snap else None
        row["condition_icon"] = snap.get("condition_icon") if snap else None
        result.append(row)
    return result


def get_search_by_id(search_id: str) -> dict | None:
    try:
        doc = searches_table.get(doc_id=int(search_id))
        return _doc_with_id(int(search_id), dict(doc)) if doc else None
    except Exception:
        return None


def delete_search(search_id: str) -> bool:
    try:
        sid = int(search_id)
        removed = searches_table.remove(doc_ids=[sid])
        snapshots_table.remove(Q.search_id == search_id)
        return len(removed) > 0
    except Exception:
        return False


def find_recent_coord_search(lat: float, lon: float, since: str) -> dict | None:
    """Dedup GPS searches within ~1km and 5 minutes."""
    def match(doc):
        try:
            return (
                abs(doc.get("lat", 0) - lat) < 0.01 and
                abs(doc.get("lon", 0) - lon) < 0.01 and
                doc.get("createdAt", "") >= since
            )
        except Exception:
            return False
    docs = searches_table.search(match)
    if docs:
        d = docs[0]
        return _doc_with_id(d.doc_id, dict(d))
    return None


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOTS  (CREATE / READ / UPDATE)
# ══════════════════════════════════════════════════════════════════════════════

def create_snapshot(data: dict) -> dict:
    data["createdAt"] = _now()
    doc_id = snapshots_table.insert(data)
    return _doc_with_id(doc_id, data)


def get_snapshot_by_search_id(search_id: str) -> dict | None:
    doc = snapshots_table.get(Q.search_id == search_id)
    return _doc_with_id(doc.doc_id, dict(doc)) if doc else None


def update_snapshot(search_id: str, data: dict):
    data["updatedAt"] = _now()
    snapshots_table.update(data, Q.search_id == search_id)


# ══════════════════════════════════════════════════════════════════════════════
# SAVED LOCATIONS  (CRUD)
# ══════════════════════════════════════════════════════════════════════════════

def create_location(data: dict) -> dict:
    # Enforce uniqueness by lat/lon
    existing = locations_table.get(
        (Q.lat == data["lat"]) & (Q.lon == data["lon"])
    )
    if existing:
        raise ValueError("Location already saved")
    data["createdAt"] = _now()
    doc_id = locations_table.insert(data)
    return _doc_with_id(doc_id, data)


def get_all_locations() -> list:
    docs = locations_table.all()
    result = [_doc_with_id(d.doc_id, dict(d)) for d in docs]
    return sorted(result, key=lambda x: x.get("name", "").lower())


def get_location_by_id(loc_id: str) -> dict | None:
    try:
        doc = locations_table.get(doc_id=int(loc_id))
        return _doc_with_id(int(loc_id), dict(doc)) if doc else None
    except Exception:
        return None


def update_location(loc_id: str, name: str) -> bool:
    try:
        updated = locations_table.update({"name": name, "updatedAt": _now()}, doc_ids=[int(loc_id)])
        return len(updated) > 0
    except Exception:
        return False


def delete_location(loc_id: str) -> bool:
    try:
        removed = locations_table.remove(doc_ids=[int(loc_id)])
        return len(removed) > 0
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# RANGE QUERIES  (CRUD)
# ══════════════════════════════════════════════════════════════════════════════

def create_range_query(data: dict) -> dict:
    data["createdAt"] = _now()
    doc_id = range_table.insert(data)
    return _doc_with_id(doc_id, data)


def get_all_range_queries(limit: int = 50, city_filter: str = "") -> tuple[list, int]:
    all_docs = range_table.all()
    if city_filter:
        all_docs = [d for d in all_docs if city_filter.lower() in d.get("city", "").lower()]
    total = len(all_docs)
    sorted_docs = sorted(all_docs, key=lambda d: d.get("createdAt", ""), reverse=True)[:limit]
    result = [_doc_with_id(d.doc_id, dict(d)) for d in sorted_docs]
    return result, total


def get_range_query_by_id(qid: str) -> dict | None:
    try:
        doc = range_table.get(doc_id=int(qid))
        return _doc_with_id(int(qid), dict(doc)) if doc else None
    except Exception:
        return None


def update_range_query(qid: str, updates: dict) -> dict | None:
    try:
        updates["updatedAt"] = _now()
        range_table.update(updates, doc_ids=[int(qid)])
        return get_range_query_by_id(qid)
    except Exception:
        return None


def delete_range_query(qid: str) -> bool:
    try:
        removed = range_table.remove(doc_ids=[int(qid)])
        return len(removed) > 0
    except Exception:
        return False


def get_all_for_export(record_type: str, limit: int = 500) -> list:
    if record_type == "searches":
        return get_all_searches(limit)
    elif record_type == "range":
        docs, _ = get_all_range_queries(limit)
        return [{k: v for k, v in d.items() if k != "forecast"} for d in docs]
    elif record_type == "locations":
        return get_all_locations()
    return []
