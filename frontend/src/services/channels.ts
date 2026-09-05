// Payment-channel categories — mirrors the backend graph/services/channel.py so
// the money-flow (edge) and money-trail (transaction) filters use one vocabulary.

export const CHANNELS = [
  'UPI', 'PhonePe', 'Paytm', 'GooglePay', 'IMPS', 'NEFT', 'RTGS', 'BLKRTGS',
  'NACH/ECS', 'ATM/Cash', 'Cheque', 'Card/POS', 'Other',
] as const;

export type Channel = (typeof CHANNELS)[number];

interface TxnLike {
  narration?: string | null;
  txn_type?: string | null;
  platform?: string | null;
}

/** Classify a transaction into exactly one channel (most-specific wins). */
export function channelOf(txn: TxnLike): Channel {
  const t = (txn.txn_type || '').toUpperCase();
  const hay = `${(txn.narration || '').toUpperCase()} ${(txn.platform || '').toUpperCase()} ${t}`;

  if (hay.includes('PHONEPE') || hay.includes('PHONE PE')) return 'PhonePe';
  if (hay.includes('PAYTM')) return 'Paytm';
  if (hay.includes('GOOGLE PAY') || hay.includes('GOOGLEPAY') || hay.includes('GPAY')) return 'GooglePay';

  if (hay.includes('BLKRTGS') || hay.includes('BULK RTGS') || hay.includes('BULKRTGS') || hay.includes('RTGS BULK')) return 'BLKRTGS';
  if (t === 'UPI' || hay.includes('UPI')) return 'UPI';
  if (t === 'IMPS' || hay.includes('IMPS')) return 'IMPS';
  if (t === 'NEFT' || hay.includes('NEFT')) return 'NEFT';
  if (t === 'RTGS' || hay.includes('RTGS')) return 'RTGS';
  if (hay.includes('NACH') || hay.includes('ACH') || hay.includes('ECS')) return 'NACH/ECS';
  if (t === 'ATM' || t === 'CASH' || hay.includes('ATM') || hay.includes('CASH')) return 'ATM/Cash';
  if (t === 'CHEQUE' || hay.includes('CHEQUE') || hay.includes('CHQ')) return 'Cheque';
  if (hay.includes('POS') || hay.includes('CARD')) return 'Card/POS';
  return 'Other';
}

/** Order a set of present channels by the canonical CHANNELS order. */
export function orderChannels(present: Iterable<string>): string[] {
  const set = new Set(present);
  return CHANNELS.filter((c) => set.has(c));
}
