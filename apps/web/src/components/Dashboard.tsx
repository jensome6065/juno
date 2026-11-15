"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Card, type Transaction } from "@/lib/api";
import { money } from "@/lib/format";
import { SiteNav } from "@/components/SiteNav";

export function Dashboard() {
  const [cards, setCards] = useState<Card[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.cards(), api.transactions()])
      .then(([c, t]) => {
        setCards(c);
        setTxs(t);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const extraTotal = txs.reduce((sum, tx) => sum + tx.extra_value, 0);
  const spendTotal = txs.reduce((sum, tx) => sum + tx.amount, 0);
  const last = txs[0] ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <SiteNav active="dashboard" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 py-10 md:py-14">
        <header className="animate-rise grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-end">
          <div className="space-y-5">
            <p className="text-sm tracking-[0.2em] text-muted uppercase">
              Account
            </p>
            <h1 className="font-[family-name:var(--font-display)] max-w-xl text-5xl leading-[0.95] font-semibold tracking-tight md:text-6xl">
              Your Juno
              <span className="block text-muted">wallet dashboard</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted">
              Link cards here, watch every routed purchase, and open the
              merchant terminal to simulate a phone tap.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/terminal"
                className="animate-pulse-ring rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
              >
                Open tap terminal
              </Link>
            </div>
            {error ? (
              <p className="text-sm text-warn">
                API error — is uvicorn running on :8000? {error}
              </p>
            ) : null}
          </div>

          <div className="animate-rise relative aspect-[1.6/1] w-full max-w-md justify-self-end overflow-hidden rounded-[28px] border border-line bg-card-face p-7 shadow-[0_30px_80px_rgba(0,0,0,0.35)] [animation-delay:100ms]">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_40%,rgba(184,242,85,0.12)_100%)]" />
            <div className="relative flex h-full flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="font-[family-name:var(--font-display)] text-2xl tracking-wide">
                  JUNO
                </span>
                <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                  virtual card
                </span>
              </div>
              <div>
                <p className="text-sm text-muted">Last routed to</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl">
                  {last?.selected_card_name ?? "Waiting for a tap"}
                </p>
                <p className="mt-2 text-sm text-accent">
                  {last
                    ? `+${money(last.extra_value)} vs ${last.default_card_name}`
                    : "Extra rewards show up after each tap"}
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="animate-rise grid gap-4 sm:grid-cols-3 [animation-delay:140ms]">
          <Stat label="Extra earned" value={money(extraTotal)} />
          <Stat label="Routed spend" value={money(spendTotal)} />
          <Stat label="Linked cards" value={String(cards.length)} />
        </section>

        <section className="animate-rise grid gap-12 [animation-delay:180ms] md:grid-cols-2">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Linked cards
            </h2>
            <p className="mt-2 text-sm text-muted">
              Juno picks among these at authorization time.
            </p>
            <ul className="mt-6 space-y-4">
              {cards.map((card) => (
                <li
                  key={card.id}
                  className="border-b border-line pb-4 last:border-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {card.name}
                        {card.is_default ? (
                          <span className="ml-2 text-xs text-muted">
                            default
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {card.issuer} ···· {card.last4}
                      </p>
                    </div>
                    <p className="text-right text-sm text-accent">
                      {card.highlight}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Transaction history
            </h2>
            <p className="mt-2 text-sm text-muted">
              Which card won, why, and how much more you earned.
            </p>
            <ul className="mt-6 space-y-4">
              {txs.length === 0 ? (
                <li className="text-sm text-muted">
                  No transactions yet — open the terminal and tap.
                </li>
              ) : (
                txs.map((tx) => (
                  <li
                    key={tx.id}
                    className="border-b border-line pb-4 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <p className="font-medium">{tx.merchant_name}</p>
                        <p className="mt-1 text-sm text-muted">
                          {tx.selected_card_name} · {tx.reason}
                        </p>
                      </div>
                      <div className="text-right">
                        <p>{money(tx.amount)}</p>
                        <p className="mt-1 text-sm text-accent">
                          +{money(tx.extra_value)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-[family-name:var(--font-display)] text-3xl">
        {value}
      </p>
    </div>
  );
}
