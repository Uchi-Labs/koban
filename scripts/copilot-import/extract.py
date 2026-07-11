#!/usr/bin/env python3
"""Extract Copilot category, tag, and account names from Firestore LevelDB strings."""

from __future__ import annotations

import argparse
import glob
import json
import subprocess
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path
import re


DEFAULT_LEVELDB_DIR = Path.home() / (
    "Library/Containers/com.copilot.production/Data/Library/Application Support/"
    "firestore/__FIRAPP_DEFAULT/copilot-production-22904.copilot-production-firestore/main"
)

DOCUMENT_RE = re.compile(
    r"projects/copilot-production-22904/databases/copilot-production-firestore/documents/([^\s\"]+)"
)
CATEGORY_RE = re.compile(r"^users/[^/]+/categories/([^/]+)$")
TAG_RE = re.compile(r"^users/[^/]+/tags/([^/]+)$")
ACCOUNT_RE = re.compile(r"^items/([^/]+)/accounts/([^/]+)$")

FIELDS = {
    "category": {"color", "emoji", "name"},
    "tag": {"color_name", "hex_color", "name"},
    "account": {
        "institution_name",
        "iso_currency_code",
        "mask",
        "name",
        "official_name",
        "original_subtype",
        "original_type",
        "subtype",
        "type",
    },
}

# Known Firestore field names that delimit a missing/short value. In the
# default `strings` output, values shorter than four characters disappear;
# without these delimiters, `name` followed by `order` would incorrectly name
# a short category "order", and a missing mask followed by `metadata` would
# become the literal mask "metadata".
FIELD_KEYS = set().union(*FIELDS.values()) | {
    "_migration_backfill",
    "_origin",
    "_replicated_at",
    "account_id",
    "apple_account_identifier",
    "auto_budget_lock",
    "auto_delete_lock",
    "available_balance",
    "bg_color",
    "children_category_ids",
    "current_balance",
    "custom_color",
    "dashboard_active",
    "device_identifiers",
    "excluded",
    "historical_update",
    "id",
    "institution_id",
    "is_manual",
    "is_other",
    "iso_currency_code",
    "item_id",
    "latest_balance_update",
    "limit",
    "live_balance_backend_disabled",
    "logo",
    "logo_content_type",
    "metadata",
    "order",
    "original_account_id",
    "original_current_balance",
    "partial_name_rules",
    "plaid_category_ids",
    "provider_deleted",
    "savings_active",
    "supportsTransactions",
    "transaction_next_token",
    "user_deleted",
    "user_hidden",
    "user_id",
    "verification_status",
}

BUCKETS = {
    "category": "categories",
    "tag": "tags",
    "account": "accounts",
}

OUTPUT_NAMES = {
    "color_name": "colorName",
    "hex_color": "hexColor",
    "institution_name": "institutionName",
    "iso_currency_code": "currency",
    "official_name": "officialName",
    "original_subtype": "originalSubtype",
    "original_type": "originalType",
}


def clean_line(raw: str) -> str:
    value = raw.strip().strip("\x00\x0b\x0c\r\n")
    if value.endswith('"'):
        value = value[:-1].rstrip()
    return value


def iter_dump_lines(path: Path) -> Iterator[str]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        yield from handle


def iter_leveldb_strings(leveldb_dir: Path, minimum_length: int = 4) -> Iterator[str]:
    files = sorted(glob.glob(str(leveldb_dir / "*.ldb")))
    if not files:
        raise FileNotFoundError(f"No .ldb files found under {leveldb_dir}")

    for filename in files:
        process = subprocess.Popen(
            ["strings", "-n", str(minimum_length), filename],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert process.stdout is not None
        yield from process.stdout
        stderr = process.stderr.read() if process.stderr else ""
        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(f"strings failed for {filename}: {stderr.strip()}")


def parse_documents(lines: Iterable[str]) -> dict[str, dict[str, dict[str, str]]]:
    output: dict[str, dict[str, dict[str, str]]] = {
        "categories": {},
        "tags": {},
        "accounts": {},
    }
    current: dict[str, str] | None = None
    current_kind: str | None = None
    current_id: str | None = None
    pending_field: str | None = None

    def flush() -> None:
        nonlocal current, current_kind, current_id, pending_field
        if current is not None and current_kind and current_id:
            bucket = output[BUCKETS[current_kind]]
            previous = bucket.get(current_id, {"id": current_id})
            bucket[current_id] = {**previous, **current}
        current = None
        current_kind = None
        current_id = None
        pending_field = None

    for raw_line in lines:
        line = clean_line(raw_line)
        document_match = DOCUMENT_RE.search(line)
        if document_match:
            flush()
            document_path = document_match.group(1)
            category_match = CATEGORY_RE.fullmatch(document_path)
            tag_match = TAG_RE.fullmatch(document_path)
            account_match = ACCOUNT_RE.fullmatch(document_path)

            if category_match:
                current_kind = "category"
                current_id = category_match.group(1)
                current = {"id": current_id}
            elif tag_match:
                current_kind = "tag"
                current_id = tag_match.group(1)
                current = {"id": current_id}
            elif account_match:
                current_kind = "account"
                current_id = account_match.group(2)
                current = {"id": current_id, "itemId": account_match.group(1)}
            continue

        if current is None or current_kind is None:
            continue

        known_fields = FIELDS[current_kind]
        if line in known_fields:
            pending_field = line
            continue

        if line in FIELD_KEYS:
            pending_field = None
            continue

        if pending_field is None:
            continue

        # Numeric/boolean protobuf values often do not survive `strings`, so a
        # field key can be followed immediately by the next key. Only retain a
        # short, printable value that is not another known field.
        if line and line not in FIELD_KEYS and len(line) <= 512:
            current[OUTPUT_NAMES.get(pending_field, pending_field)] = line
        pending_field = None

    flush()

    # FinanceKit stores Apple Wallet display names as adjacent string values
    # ("Apple" then "Card"/"Cash") rather than one contiguous value.
    for account in output["accounts"].values():
        for key, value in list(account.items()):
            if isinstance(value, str) and value.lower() in {"null", "undefined"}:
                account.pop(key, None)
        if account.get("mask") and not re.fullmatch(r"\d{1,4}", account["mask"]):
            account.pop("mask", None)
        if account.get("institutionName") == "Apple Wallet":
            suffix = "Card" if "credit" in account.get("originalSubtype", "").lower() else "Cash"
            for field in ("name", "officialName"):
                if account.get(field) == "Apple":
                    account[field] = f"Apple {suffix}"
    return output


def merge_missing_values(
    primary: dict[str, dict[str, dict[str, str]]],
    supplemental: dict[str, dict[str, dict[str, str]]],
) -> dict[str, dict[str, dict[str, str]]]:
    for bucket_name, documents in supplemental.items():
        bucket = primary[bucket_name]
        for document_id, values in documents.items():
            target = bucket.setdefault(document_id, {"id": document_id})
            for key, value in values.items():
                if key not in target and value and value not in FIELD_KEYS:
                    target[key] = value
    return primary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--leveldb-dir",
        type=Path,
        default=DEFAULT_LEVELDB_DIR,
        help="Firestore LevelDB directory used when --strings-dump is omitted.",
    )
    parser.add_argument(
        "--strings-dump",
        type=Path,
        help="Existing `strings` output to parse instead of reading the live .ldb files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("mappings.json"),
    )
    args = parser.parse_args()

    lines = iter_dump_lines(args.strings_dump) if args.strings_dump else iter_leveldb_strings(args.leveldb_dir)
    mappings = parse_documents(lines)
    # The normal strings pass is much less noisy but omits values shorter than
    # four bytes. Supplement only fields still missing from a `-n 1` pass so
    # binary one-byte fragments can never overwrite a good normal-pass value.
    if args.leveldb_dir.exists():
        mappings = merge_missing_values(mappings, parse_documents(iter_leveldb_strings(args.leveldb_dir, 1)))
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(args.strings_dump or args.leveldb_dir),
        **mappings,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        "Extracted "
        f"{len(mappings['categories'])} categories, "
        f"{len(mappings['tags'])} tags, and "
        f"{len(mappings['accounts'])} accounts to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
