import React from 'react';

// Lightweight, dependency-free SVG charts for the report page. Reuse the app's
// existing palette / mono-label styling so nothing looks bolted-on.

const PALETTE = [
  '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0891B2',
  '#DB2777', '#65A30D', '#4B5563', '#B45309', '#9333EA', '#0D9488', '#E11D48',
];

export interface ChannelDatum {
  channel: string;
  count: number;
  value?: number;
  share?: number;
}

export interface TimelineDatum {
  date: string;
  count: number;
  credit: number;
  debit: number;
}

// --- Donut: transaction share by channel -----------------------------------
export function ChannelDonut({ data }: { data: ChannelDatum[] }) {
  const items = data.filter((d) => d.count > 0);
  const total = items.reduce((s, d) => s + d.count, 0);
  if (!total) return null;

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const stroke = 30;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {items.map((d, i) => {
            const frac = d.count / total;
            const dash = frac * circ;
            const seg = (
              <circle
                key={d.channel}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return seg;
          })}
        </g>
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-[#18181B]" style={{ fontSize: 22, fontWeight: 700 }}>
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-[#71717A]" style={{ fontSize: 9, fontFamily: 'monospace' }}>
          TXNS
        </text>
      </svg>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {items.map((d, i) => (
          <div key={d.channel} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
            <span className="font-semibold text-[#18181B]">{d.channel}</span>
            <span className="text-[#71717A] font-mono">
              {d.count} · {Math.round((d.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Horizontal bars: transactions per channel/class -----------------------
export function ChannelBars({ data }: { data: ChannelDatum[] }) {
  const items = data.filter((d) => d.count > 0);
  const max = Math.max(1, ...items.map((d) => d.count));
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((d, i) => (
        <div key={d.channel} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-right font-semibold text-[#52525B] truncate">{d.channel}</span>
          <div className="flex-1 bg-[#F4F4F5] rounded-sm h-4 overflow-hidden">
            <div
              className="h-full rounded-sm flex items-center justify-end pr-1.5"
              style={{ width: `${(d.count / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length], minWidth: 18 }}
            >
              <span className="text-[9px] font-bold text-white font-mono">{d.count}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Fund velocity over time: count bars + credit/debit lines ---------------
export function VelocityChart({ data }: { data: TimelineDatum[] }) {
  const pts = data.filter(Boolean);
  if (pts.length < 2) return null;

  const w = 640;
  const h = 200;
  const padL = 40;
  const padR = 16;
  const padT = 12;
  const padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxCount = Math.max(1, ...pts.map((p) => p.count));
  const maxVal = Math.max(1, ...pts.map((p) => Math.max(p.credit, p.debit)));
  const n = pts.length;
  const bandW = innerW / n;

  const x = (i: number) => padL + bandW * i + bandW / 2;
  const yCount = (c: number) => padT + innerH - (c / maxCount) * innerH;
  const yVal = (v: number) => padT + innerH - (v / maxVal) * innerH;

  const line = (key: 'credit' | 'debit') =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${yVal(p[key])}`).join(' ');

  const step = Math.max(1, Math.floor(n / 8));

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="min-w-[520px]">
        {/* count bars */}
        {pts.map((p, i) => {
          const bh = (p.count / maxCount) * innerH;
          return (
            <rect
              key={i}
              x={padL + bandW * i + bandW * 0.2}
              y={padT + innerH - bh}
              width={bandW * 0.6}
              height={bh}
              fill="#E2E8F0"
            />
          );
        })}
        {/* credit / debit value lines */}
        <path d={line('credit')} fill="none" stroke="#059669" strokeWidth={1.8} />
        <path d={line('debit')} fill="none" stroke="#DC2626" strokeWidth={1.8} />
        {/* x labels */}
        {pts.map((p, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={h - 12} textAnchor="middle" className="fill-[#71717A]" style={{ fontSize: 8, fontFamily: 'monospace' }}>
              {p.date?.slice(5) || p.date}
            </text>
          ) : null
        )}
        {/* legend */}
        <g transform={`translate(${padL}, ${padT})`} style={{ fontSize: 9 }}>
          <rect x={0} y={-2} width={9} height={9} fill="#E2E8F0" />
          <text x={13} y={6} className="fill-[#52525B]">Txn count</text>
          <line x1={70} y1={2} x2={84} y2={2} stroke="#059669" strokeWidth={2} />
          <text x={88} y={6} className="fill-[#52525B]">Credit</text>
          <line x1={130} y1={2} x2={144} y2={2} stroke="#DC2626" strokeWidth={2} />
          <text x={148} y={6} className="fill-[#52525B]">Debit</text>
        </g>
      </svg>
    </div>
  );
}
