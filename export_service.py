"""
export_service.py — Data export (JSON, CSV, XML, Markdown)
Uses only Python standard library — no third-party packages.
"""

from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


# ── JSON ──────────────────────────────────────────────────────────────────────

def to_json(records: list[dict], record_type: str) -> str:
    return json.dumps(
        {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "type":        record_type,
            "count":       len(records),
            "data":        records,
        },
        default=str,
        indent=2,
    )


# ── CSV ───────────────────────────────────────────────────────────────────────

def to_csv(records: list[dict]) -> str:
    if not records:
        return ""

    # Flatten one level: nested dicts/lists become JSON strings in a cell
    flat = []
    for r in records:
        row = {}
        for k, v in r.items():
            if k.startswith("_") and k != "_id":
                continue  # skip TinyDB internals
            row[k] = json.dumps(v, default=str) if isinstance(v, (dict, list)) else v
        flat.append(row)

    buf     = io.StringIO()
    headers = list(flat[0].keys())
    writer  = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(flat)
    return buf.getvalue()


# ── XML ───────────────────────────────────────────────────────────────────────

def to_xml(records: list[dict], root_tag: str, item_tag: str) -> str:
    root = ET.Element(root_tag)
    for r in records:
        item = ET.SubElement(root, item_tag)
        for k, v in r.items():
            if k.startswith("_") and k != "_id":
                continue
            child      = ET.SubElement(item, k)
            child.text = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v or "")

    # Pretty-print with 2-space indent (ET.indent available in Python 3.9+)
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


# ── Markdown ──────────────────────────────────────────────────────────────────

def to_markdown(records: list[dict], title: str) -> str:
    if not records:
        return f"# {title}\n\n_No records found._"

    exclude = {"raw_json", "forecast"}
    keys    = [k for k in records[0] if k not in exclude and (not k.startswith("_") or k == "_id")]

    header = "| " + " | ".join(keys) + " |"
    sep    = "| " + " | ".join(["---"] * len(keys)) + " |"
    rows   = []
    for r in records:
        cells = []
        for k in keys:
            v = r.get(k, "")
            if isinstance(v, (dict, list)):
                v = json.dumps(v, default=str)
            cells.append(str(v or "").replace("|", "\\|"))
        rows.append("| " + " | ".join(cells) + " |")

    ts = datetime.now(timezone.utc).isoformat()
    return f"# {title}\n\n_Exported: {ts}_\n\n{header}\n{sep}\n" + "\n".join(rows)
