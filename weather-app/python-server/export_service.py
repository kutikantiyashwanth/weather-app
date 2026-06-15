"""
export_service.py — Data export to JSON, CSV, XML, Markdown
Assessment 2.3
"""

import csv
import io
import json
import xml.etree.ElementTree as ET
from datetime import datetime


def to_json(records: list, record_type: str) -> str:
    return json.dumps({
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "type":        record_type,
        "count":       len(records),
        "data":        records,
    }, default=str, indent=2)


def to_csv(records: list) -> str:
    if not records:
        return ""
    exclude = {"raw_json", "forecast", "pollutants"}
    # Flatten keys — nested dicts become JSON strings
    flat = []
    for r in records:
        row = {}
        for k, v in r.items():
            if k in exclude:
                continue
            if isinstance(v, dict):
                row[k] = json.dumps(v)
            else:
                row[k] = v
        flat.append(row)

    headers = list(flat[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(flat)
    return buf.getvalue()


def to_xml(records: list, root_tag: str, item_tag: str) -> str:
    exclude = {"raw_json", "forecast"}
    root = ET.Element(root_tag)
    for rec in records:
        item = ET.SubElement(root, item_tag)
        for k, v in rec.items():
            if k in exclude:
                continue
            child = ET.SubElement(item, str(k).replace(" ", "_"))
            if isinstance(v, (dict, list)):
                child.text = json.dumps(v)
            else:
                child.text = str(v) if v is not None else ""
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def to_markdown(records: list, title: str) -> str:
    if not records:
        return f"# {title}\n\n_No records found._"
    exclude = {"raw_json", "forecast", "pollutants"}
    keys = [k for k in records[0].keys() if k not in exclude]

    header = "| " + " | ".join(keys) + " |"
    sep    = "| " + " | ".join(["---"] * len(keys)) + " |"
    rows = []
    for r in records:
        cells = []
        for k in keys:
            v = r.get(k, "")
            if isinstance(v, (dict, list)):
                v = json.dumps(v)
            cells.append(str(v).replace("|", "\\|"))
        rows.append("| " + " | ".join(cells) + " |")

    return (f"# {title}\n\n"
            f"_Exported: {datetime.utcnow().isoformat()}Z_\n\n"
            f"{header}\n{sep}\n" + "\n".join(rows))
