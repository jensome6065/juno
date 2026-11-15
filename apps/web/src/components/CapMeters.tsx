"use client";

import type { CapBucket, CapStatus } from "@/lib/api";
import { money } from "@/lib/format";

type Props = {
  caps: CapStatus | null;
  /** Bumps when caps refresh so meters briefly glow. */
  pulseKey?: number;
  /** Drop the outer section chrome when nested in a tab panel. */
  embedded?: boolean;
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

export function CapMeters({ caps, pulseKey = 0, embedded = false }: Props) {
  if (!caps) {
    return embedded ? (
      <p className="text-sm text-muted">Loading cap meters…</p>
    ) : null;
  }

  const rows: { key: string; label: string; data: CapBucket }[] = [];
  for (const item of FEATURED) {
    const data = caps.caps[item.cardId]?.[item.bucket];
    if (data) rows.push({ key: `${item.cardId}-${item.bucket}`, label: item.label, data });
  }
  if (!rows.length) {
    return embedded ? (
      <p className="text-sm text-muted">No bonus caps to show yet.</p>
    ) : null;
  }

  const list = (
    <ul className={`grid gap-6 sm:grid-cols-2 ${embedded ? "" : "mt-8"}`}>
      {rows.map((row) => {
        const pct = Math.min(100, Math.round(row.data.progress * 100));
        return (
          <li
            key={`${row.key}-${pulseKey}`}
            className={`space-y-3 ${pulseKey > 0 ? "animate-cap-glow rounded-lg" : ""}`}
          >
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
  );

  if (embedded) return list;

  return (
    <section className="border-t border-line pt-10">
      <h2 className="font-[family-name:var(--font-display)] text-2xl">
        Bonus caps this period
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Live from the ledger. Taps and the pitch script fill these meters.
      </p>
      {list}
    </section>
  );
}
