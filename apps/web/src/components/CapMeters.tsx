"use client";

import type { CapBucket, CapStatus } from "@/lib/api";
import { money } from "@/lib/format";

type Props = {
  caps: CapStatus | null;
};

const FEATURED: { cardId: string; bucket: string; label: string }[] = [
  {
    cardId: "freedom_flex",
    bucket: "rotating",
    label: "Freedom Flex · rotating",
  },
  {
    cardId: "amex_gold",
    bucket: "groceries",
    label: "Amex Gold · groceries",
  },
];

export function CapMeters({ caps }: Props) {
  if (!caps) return null;

  const rows: { key: string; label: string; data: CapBucket }[] = [];
  for (const item of FEATURED) {
    const data = caps.caps[item.cardId]?.[item.bucket];
    if (data) rows.push({ key: `${item.cardId}-${item.bucket}`, label: item.label, data });
  }
  if (!rows.length) return null;

  return (
    <section className="border-t border-line pt-10">
      <h2 className="font-[family-name:var(--font-display)] text-2xl">
        Bonus caps this period
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Live from the ledger — taps and the pitch script fill these meters.
      </p>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {rows.map((row) => {
          const pct = Math.min(100, Math.round(row.data.progress * 100));
          return (
            <li key={row.key} className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-medium">{row.label}</p>
                  <p className="mt-1 text-xs text-muted">
                    {row.data.period.replaceAll("_", " ")} · {row.data.period_id}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  {money(row.data.spent)} / {money(row.data.limit)}
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-sm text-accent">
                {money(row.data.remaining)} remaining
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
