"""
TextStatementReconstructor — converts raw page-text from a text-based PDF
(pdfplumber `extract_text`) into structured transaction row dicts.

Why this exists
---------------
PDF/Excel/CSV parsers disagreed on the `rows` contract: CSV/Excel emit
list[dict], but the PDF parser emitted list[str] (one big text blob per page).
Downstream `standardize` requires list[dict] -> 422 on every text PDF.

This stage closes that gap in a *bank-agnostic, layout-aware* way:

  * A transaction is anchored by a line containing a date (dd/mm/yy or
    dd-mm-yyyy ...). Narration may be split across the line(s) immediately
    before/within the anchor.
  * Monetary values are matched as formatted money tokens (``1,083,492.00``)
    so reference numbers (``92244994``) are never mistaken for amounts.
  * The LAST money token on an anchor line is the running balance; debit vs
    credit is derived from the *balance delta* against the previous row. This
    sidesteps the column-position ambiguity that plain text extraction loses,
    and works for any statement that prints a running balance (≈ all of them).

Output rows use canonical-ish keys so the existing Column Intelligence resolver
maps them trivially: ``date, time, value_date, narration, ref_no, debit,
credit, balance``.
"""

from __future__ import annotations

import re
from typing import Optional


# dd/mm/yy, dd-mm-yy, dd/mm/yyyy, dd-mm-yyyy, dd-Mon-yyyy
_DATE = re.compile(
    r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4})\b"
)
_TIME = re.compile(r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b")
# formatted money: requires decimals to avoid grabbing ref/account numbers
_MONEY = re.compile(r"\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}")
# money token possibly suffixed by Cr/Dr (balance sign)
_MONEY_SIGNED = re.compile(r"(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(Cr|Dr)?", re.I)

# Lines that are page furniture / footers / section noise -> never narration.
_NOISE = re.compile(
    r"(registered office|page\s+\d+\s+of|important message|important safety|"
    r"commonly used abbreviations|end of the statement|this statement is a system|"
    r"^\s*[•·]\s|www\.|@)",
    re.I,
)
# Header line of the transaction table (used to (re)start the table on each page).
_HEADER_HINT = re.compile(
    r"(transaction details|particulars|narration|description).*"
    r"(debit|credit|withdrawal|deposit|balance)",
    re.I,
)
_BALANCE_HINT = re.compile(r"\bbalance\b", re.I)


def _money(tok: str) -> Optional[float]:
    try:
        return float(tok.replace(",", ""))
    except Exception:
        return None


class TextStatementReconstructor:

    def reconstruct(self, pages: list[str]) -> list[dict]:
        """Reconstruct transaction dict rows from a list of page-text strings."""
        lines: list[str] = []
        for page in pages:
            if not page:
                continue
            for ln in str(page).split("\n"):
                ln = ln.replace("_x000D_", " ").strip()
                if ln:
                    lines.append(ln)

        prev_balance = self._find_opening_balance(lines)
        rows: list[dict] = []
        narration_buffer: list[str] = []
        in_table = False

        for ln in lines:
            if _HEADER_HINT.search(ln):
                in_table = True
                narration_buffer = []
                continue
            if _NOISE.search(ln):
                narration_buffer = []
                continue

            has_date = bool(_DATE.search(ln))
            money_tokens = _MONEY.findall(ln)

            # Anchor line = has a date AND at least one money token (the balance).
            if has_date and money_tokens:
                in_table = True
                row, prev_balance = self._parse_anchor(
                    ln, narration_buffer, prev_balance
                )
                if row is not None:
                    rows.append(row)
                narration_buffer = []
            else:
                # A line with neither a date nor a money token is narration.
                # Attribution is ambiguous from text alone, so we use the
                # dominant Indian-bank layout: narration WRAPS BELOW its
                # amount row, i.e. it belongs to the PREVIOUS (already-emitted)
                # transaction. Before the first anchor there is no previous
                # row, so such lines are buffered as the lead-in for the first
                # transaction. Each line is attributed to exactly ONE
                # transaction (no double counting).
                if in_table and not _BALANCE_HINT.search(ln):
                    if rows:
                        self._append_tail(rows[-1], ln.strip())
                    else:
                        narration_buffer.append(ln)

        return rows

    @staticmethod
    def _append_tail(row: dict, extra: str):
        """Append a wrapped continuation line to a row's narration, once."""
        if not extra:
            return
        base = row.get("narration") or ""
        if extra not in base:
            row["narration"] = (f"{base} {extra}".strip()) if base else extra
            # a longer narration may expose a better reference number
            new_ref = TextStatementReconstructor._extract_ref(row["narration"])
            if new_ref and not row.get("ref_no"):
                row["ref_no"] = new_ref

    # ------------------------------------------------------------------ #

    def _find_opening_balance(self, lines: list[str]) -> Optional[float]:
        for ln in lines:
            if re.search(r"opening balance", ln, re.I):
                m = _MONEY.search(ln)
                if m:
                    return _money(m.group(0))
        return None

    def _parse_anchor(
        self,
        line: str,
        narration_buffer: list[str],
        prev_balance: Optional[float],
    ):
        dates = _DATE.findall(line)
        times = _TIME.findall(line)
        signed = _MONEY_SIGNED.findall(line)  # list of (number, sign)
        money_vals = [(_money(n), s) for n, s in signed if _money(n) is not None]

        if not money_vals:
            return None, prev_balance

        # Last money token is the running balance (carry its Cr/Dr sign).
        bal_val, bal_sign = money_vals[-1]
        balance = bal_val
        if bal_sign and bal_sign.lower() == "dr" and balance is not None:
            balance = -abs(balance)

        # Explicit transaction amount = second-to-last money token if present.
        explicit_amount = money_vals[-2][0] if len(money_vals) >= 2 else None

        # Direction & amount from balance delta (source of truth) when possible.
        debit = credit = None
        if prev_balance is not None and balance is not None:
            delta = round(balance - prev_balance, 2)
            if delta < 0:
                debit = abs(delta)
            elif delta > 0:
                credit = delta
            # delta == 0 -> leave both None (e.g. info row)
        elif explicit_amount is not None:
            # No running reference yet: fall back to explicit amount as debit.
            debit = explicit_amount

        # Build narration: buffered lines + anchor line minus date/time/money.
        anchor_text = line
        for d in dates:
            anchor_text = anchor_text.replace(d, " ")
        for t in times:
            anchor_text = anchor_text.replace(t, " ")
        anchor_text = _MONEY_SIGNED.sub(" ", anchor_text)
        anchor_text = re.sub(r"\b(Cr|Dr)\b", " ", anchor_text, flags=re.I)
        narration_parts = [p for p in narration_buffer] + [anchor_text]
        narration = re.sub(r"\s+", " ", " ".join(narration_parts)).strip(" /-")

        ref_no = self._extract_ref(narration)

        row = {
            "date": dates[0] if dates else None,
            "time": times[0] if times else None,
            "value_date": dates[1] if len(dates) > 1 else None,
            "narration": narration or None,
            "ref_no": ref_no,
            "debit": debit,
            "credit": credit,
            "balance": balance,
        }
        return row, (balance if balance is not None else prev_balance)

    @staticmethod
    def _extract_ref(narration: str) -> Optional[str]:
        if not narration:
            return None
        # Longest digit run of length >= 8 is a decent reference candidate.
        cands = re.findall(r"\d{8,}", narration)
        if cands:
            return max(cands, key=len)
        return None
