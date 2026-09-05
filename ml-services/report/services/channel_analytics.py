"""
Channel / category / velocity analytics for investigation reports.

Turns the raw transaction rows into the counts investigators asked for:
  * per-channel counts + value (UPI, PhonePe, Paytm, NEFT, RTGS, BLKRTGS, ...)
  * transaction "classes" (the same channels, presented as a labelled table
    with the count under each — "no. of transactions under BLKRTGS / NEFT /
    Paytm / ...")
  * category headline counts: ATM withdrawals, cash deposits, failed txns,
    cheque, card/POS, digital vs cash, credits vs debits
  * an activity timeline (per-date txn count + credit/debit value) that drives
    the fund-velocity / time chart

Deterministic and dependency-free (pure Python) — matches the rest of the
system. Chart *rendering* is separate (chart_images / native Excel charts).
"""

from __future__ import annotations

from collections import defaultdict

from services.channel import channel_of, CHANNELS


def _f(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def _is_cash(narr, ttype):
    hay = f"{(narr or '').upper()} {(ttype or '').upper()}"
    return ("ATM" in hay or "CASH" in hay or "WDL" in hay or "NFS" in hay)


def compute(transactions):
    """Return the full analytics block for a list of transaction rows."""
    channel_count = defaultdict(int)
    channel_value = defaultdict(float)
    date_count = defaultdict(int)
    date_credit = defaultdict(float)
    date_debit = defaultdict(float)

    atm_withdrawals = 0
    cash_deposits = 0
    failed = 0
    credits = 0
    debits = 0
    total = 0

    for t in (transactions or []):
        total += 1
        narr = t.get("narration")
        ttype = t.get("txn_type")
        direction = (t.get("debit_credit") or "").upper()
        amount = _f(t.get("amount"))
        date = t.get("date")

        ch = channel_of(t)
        channel_count[ch] += 1
        channel_value[ch] += amount

        if t.get("is_failed"):
            failed += 1
        if direction == "CREDIT":
            credits += 1
        elif direction == "DEBIT":
            debits += 1

        if _is_cash(narr, ttype):
            if direction == "DEBIT":
                atm_withdrawals += 1
            elif direction == "CREDIT":
                cash_deposits += 1

        if date:
            date_count[date] += 1
            if direction == "CREDIT":
                date_credit[date] += amount
            elif direction == "DEBIT":
                date_debit[date] += amount

    # Ordered channel breakdown (only channels actually present, canonical order
    # first then any stragglers), with count + value + share.
    present = [c for c in CHANNELS if channel_count.get(c)]
    present += [c for c in channel_count if c not in CHANNELS]
    channel_breakdown = [
        {
            "channel": c,
            "count": channel_count[c],
            "value": round(channel_value[c], 2),
            "share": round(channel_count[c] / total, 4) if total else 0.0,
        }
        for c in present
    ]

    # Category headline counts (the "at a glance" tiles).
    categories = {
        "total_transactions": total,
        "credits": credits,
        "debits": debits,
        "atm_withdrawals": atm_withdrawals,
        "cash_deposits": cash_deposits,
        "failed_transactions": failed,
        "cheque": channel_count.get("Cheque", 0),
        "card_pos": channel_count.get("Card/POS", 0),
        "digital_upi": (channel_count.get("UPI", 0)
                        + channel_count.get("PhonePe", 0)
                        + channel_count.get("Paytm", 0)
                        + channel_count.get("GooglePay", 0)),
    }

    # Activity timeline (chronological) for the velocity/time chart.
    timeline = [
        {
            "date": d,
            "count": date_count[d],
            "credit": round(date_credit.get(d, 0.0), 2),
            "debit": round(date_debit.get(d, 0.0), 2),
        }
        for d in sorted(date_count)
    ]

    return {
        "channel_breakdown": channel_breakdown,
        "categories": categories,
        "timeline": timeline,
    }
