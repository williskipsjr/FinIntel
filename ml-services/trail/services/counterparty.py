"""Compact narration -> counterparty resolver (mirrors the graph engine's
logic) so the money trail can show WHERE each debit sent the money.

Resolution order: UPI VPA -> payee name after a VPA -> known merchant ->
ATM/CASH -> beneficiary abbreviation after /CR|DR/ -> the most distinctive
name token in the narration. Only returns None when the narration is empty or
carries no usable token at all — in which case the UI falls back to the raw
narration text (never a bare 'Unspecified Account')."""

import re

_UPI = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9]+")
_NAME_AFTER_VPA = re.compile(
    r"@[A-Za-z0-9]+/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})")
_MERCHANTS = ("PAYTM", "PHONEPE", "GOOGLE PAY", "GPAY", "AMAZON", "FLIPKART",
              "SWIGGY", "ZOMATO", "JIO", "AIRTEL")

# beneficiary abbreviation immediately after a /CR/ or /DR/ marker
_CD_TOKEN = re.compile(r"/(?:CR|DR)/([A-Za-z]{3,})")
_ALPHA_TOKEN = re.compile(r"[A-Za-z]{4,}")
_CP_STOPWORDS = {
    "UPI", "IMPS", "NEFT", "RTGS", "ATM", "POS", "CASH", "SELF", "PAYMENT",
    "PAY", "REQUEST", "TRANSFER", "CREDIT", "DEBIT", "BANK", "LIMITED", "LTD",
    "BRANCH", "INDIA", "INR", "WITHDRAWAL", "DEPOSIT", "CHARGES", "CHARGE",
    "GST", "INT", "OPENING", "CLOSING", "BALANCE", "BROUGHT", "FORWARD",
    "REVERSAL", "REVERSED", "REFUND", "MOB", "CBS", "BULKPAYMENT", "NEFTCR",
    "IMPSCR", "TRANSACTION", "ACCOUNT", "NUMBER", "VALUE", "DATE",
}
# IFSC bank-code prefixes — routing codes, not counterparties
_BANK_CODES = {
    "YESB", "HDFC", "ICIC", "SBIN", "BARB", "PUNB", "CNRB", "IDIB", "UTIB",
    "UBIN", "MAHB", "IDFB", "INDB", "FINO", "IPOS", "AIRP", "ESFB", "UJVN",
    "JAKA", "DCBL", "RATN", "FDRL", "SIBL", "KVBL", "KKBK", "IOBA", "PYTM",
}
# Generic business-entity descriptor words (mirrors the graph engine) — on
# their own they don't identify WHICH company this was, so the "longest
# token" heuristic must not pick one as the destination name (it usually IS
# the longest word in the narration, e.g. "... Enterprises Private Limited").
_GENERIC_ENTITY_WORDS = {
    "ENTERPRISE", "ENTERPRISES", "INDUSTRY", "INDUSTRIES", "PRIVATE", "PVT",
    "COMPANY", "CORP", "CORPORATION", "GROUP", "TRADERS", "TRADING",
    "ASSOCIATES", "VENTURES", "SOLUTIONS", "SERVICES", "SERVICE", "INC",
    "LLP", "FIRM", "STORES", "STORE", "HOUSE", "MART", "AGENCY", "AGENCIES",
    "EXPORTS", "IMPORTS", "INTERNATIONAL", "GLOBAL", "HOLDINGS",
    "CONSULTANCY", "CONSULTANTS", "INFOTECH", "TECHNOLOGIES", "TECHNOLOGY",
    "SYSTEMS", "PROJECTS", "PROJECT", "CONSTRUCTION", "CONSTRUCTIONS",
    "MARKETING", "SUPPLIERS", "SUPPLY", "DISTRIBUTORS", "DISTRIBUTION",
    "AUTOMOBILES", "MOTORS", "TEXTILES", "FOODS", "ENGINEERING", "WORKS",
}


def _beneficiary_token(narration_upper: str):
    cands = [
        t for t in _ALPHA_TOKEN.findall(narration_upper)
        if t not in _CP_STOPWORDS and t not in _BANK_CODES
    ]
    specific = [t for t in cands if t not in _GENERIC_ENTITY_WORDS]
    if specific:
        return max(specific, key=len)
    # Every candidate was a generic descriptor -- don't guess. Returning None
    # here makes the caller fall back to the raw narration text (see module
    # docstring), which is more useful to an investigator than a generic
    # bucket name shared by unrelated businesses.
    return None


def resolve(narration: str):
    narr = narration or ""
    if not narr:
        return None
    m = _UPI.search(narr)
    if m and not (m.end() < len(narr) and narr[m.end()] == "."):
        return m.group(0).lower()
    pm = _NAME_AFTER_VPA.search(narr)
    if pm:
        return pm.group(1).strip().upper()
    up = narr.upper()
    for mk in _MERCHANTS:
        if mk in up:
            return mk
    if "ATM" in up or "CASH" in up:
        return "CASH"
    cd = _CD_TOKEN.search(narr)
    if cd:
        tok = cd.group(1).upper()
        if (tok not in _CP_STOPWORDS and tok not in _BANK_CODES
                and tok not in _GENERIC_ENTITY_WORDS):
            return tok
    # last resort: the most distinctive name token in the narration
    return _beneficiary_token(up)
