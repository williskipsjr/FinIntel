"""
Payment-channel classifier — segregates each transaction into ONE container
(UPI / PhonePe / Paytm / GooglePay / IMPS / NEFT / RTGS / ATM-Cash / Cheque /
Card-POS / Other). Most-specific wins: a PhonePe UPI transfer lands in "PhonePe",
not the generic "UPI" bucket, so every transaction has exactly one channel.

Deterministic (reads narration + txn_type), so it matches the rest of the system.
"""

# canonical ordered category list (for building the frontend dropdown)
CHANNELS = [
    "UPI", "PhonePe", "Paytm", "GooglePay", "IMPS", "NEFT", "RTGS", "BLKRTGS",
    "NACH/ECS", "ATM/Cash", "Cheque", "Card/POS", "Other",
]


def channel_of(txn):
    narr = (txn.get("narration") or "").upper()
    plat = (txn.get("platform") or "").upper()
    ttype = (txn.get("txn_type") or "").upper()
    hay = f"{narr} {plat} {ttype}"

    # payment apps first (most specific)
    if "PHONEPE" in hay or "PHONE PE" in hay:
        return "PhonePe"
    if "PAYTM" in hay:
        return "Paytm"
    if "GOOGLE PAY" in hay or "GOOGLEPAY" in hay or "GPAY" in hay:
        return "GooglePay"

    # rails — bulk RTGS is more specific than RTGS, so check it first
    if "BLKRTGS" in hay or "BULK RTGS" in hay or "BULKRTGS" in hay \
            or "RTGS BULK" in hay:
        return "BLKRTGS"
    if ttype == "UPI" or "UPI" in hay:
        return "UPI"
    if ttype == "IMPS" or "IMPS" in hay:
        return "IMPS"
    if ttype == "NEFT" or "NEFT" in hay:
        return "NEFT"
    if ttype == "RTGS" or "RTGS" in hay:
        return "RTGS"
    if "NACH" in hay or "ACH" in hay or "ECS" in hay:
        return "NACH/ECS"
    if ttype in ("ATM", "CASH") or "ATM" in hay or "CASH" in hay:
        return "ATM/Cash"
    if ttype == "CHEQUE" or "CHEQUE" in hay or "CHQ" in hay:
        return "Cheque"
    if "POS" in hay or "CARD" in hay:
        return "Card/POS"
    return "Other"
