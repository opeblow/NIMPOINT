const ngnFmt = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const nimFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const ngn = (n: number) => `₦${ngnFmt.format(Math.round(n))}`;
export const nim = (n: number) => `${nimFmt.format(n)} NIM`;
export const nimPlain = (n: number) => nimFmt.format(n);

export const rate = (r: number) => `₦${r.toFixed(r < 1 ? 4 : 2)}`;

export const shortAddress = (a: string) => {
  const s = a.replace(/\s+/g, '');
  return s.length > 12 ? `${s.slice(0, 4)} ${s.slice(4, 8)} … ${s.slice(-4)}` : a;
};

export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const maskAccount = (n: string) => (n.length > 4 ? `•••• ${n.slice(-4)}` : n);
