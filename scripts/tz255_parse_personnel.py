from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from docx import Document


EXPECTED_DEPARTMENTS = [
    "Картофелехранилище",
    "Автопарк",
    "АУП",
    "Животноводство",
    "Маш.двор",
    "Мехток",
    "МТМ",
    "Нефтебаза",
    "Растениеводство",
    "центральная столовая",
]


def clean_name(value: str) -> str:
    return re.sub(r"\s*\(осн\.\)\s*$", "", value).strip()


def derive_role(position: str) -> str:
    if position == "Водитель":
        return "driver"
    if position == "Механизатор":
        return "mechanic_operator"
    return "other"


def parse_people(source: Path) -> dict:
    document = Document(source)
    people: list[dict[str, str]] = []
    departments: list[str] = []
    current_department: str | None = None

    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            first = cells[0] if cells else ""
            if first in EXPECTED_DEPARTMENTS and (len(cells) == 1 or all(value == first for value in cells)):
                current_department = first
                if first not in departments:
                    departments.append(first)
                continue
            if current_department is None or len(cells) < 3:
                continue
            full_name, payroll_number, position = cells[:3]
            if not full_name or not payroll_number.isdigit() or not position:
                continue
            people.append(
                {
                    "full_name": clean_name(full_name),
                    "position": position,
                    "department": current_department,
                    "role_type": derive_role(position),
                }
            )

    duplicate_counter = Counter(
        (item["full_name"].casefold(), item["position"].casefold(), item["department"].casefold())
        for item in people
    )
    duplicates = [
        {"full_name": key[0], "position": key[1], "department": key[2], "count": count}
        for key, count in duplicate_counter.items()
        if count > 1
    ]
    source_bytes = source.read_bytes()
    return {
        "source": str(source.resolve()),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest().upper(),
        "source_rows": len(people),
        "parsed_people": len(people),
        "departments": departments,
        "department_counts": dict(Counter(item["department"] for item in people)),
        "drivers": sum(item["position"] == "Водитель" for item in people),
        "machine_operators": sum(item["position"] == "Механизатор" for item in people),
        "duplicates": duplicates,
        "auth_users_to_create": 0,
        "people": people,
    }


def validate(payload: dict) -> None:
    errors = []
    if payload["source_rows"] != 165 or payload["parsed_people"] != 165:
        errors.append("Expected exactly 165 personnel rows")
    if payload["departments"] != EXPECTED_DEPARTMENTS:
        errors.append("Department list/order does not match the approved source contract")
    if payload["duplicates"]:
        errors.append("Unexpected duplicate personnel rows found")
    if payload["drivers"] != 17:
        errors.append("Expected exactly 17 drivers")
    if payload["machine_operators"] != 18:
        errors.append("Expected exactly 18 machine operators")
    if errors:
        raise SystemExit("; ".join(errors))


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse the approved TZ255 personnel DOCX")
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()

    payload = parse_people(args.source)
    validate(payload)
    output_payload = {key: value for key, value in payload.items() if key != "people"} if args.summary_only else payload
    rendered = json.dumps(output_payload, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
