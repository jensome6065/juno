"use client";

import { useEffect, useState, useTransition } from "react";
import {
  api,
  type Card,
  type Merchant,
  type SimulateResponse,
  type Transaction,
} from "@/lib/api";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function WalletDemo() {
  const [cards, setCards] = useState<Card[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [last, setLast] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const [c, m, t] = await Promise.all([
      api.cards(),
      api.merchants(),
      api.transactions(),
    ]);
    setCards(c);
    setMerchants(m);
    setTxs(t);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  function tap(merchantId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await api.simulate(merchantId);
        setLast(result);
        const [c, t] = await Promise.all([api.cards(), api.transactions()]);
        setCards(c);
        setTxs(t);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Simulate failed");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-10 md:py-16">
      <header className="animate-rise grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-end">
        <div className="space-y-6">
          <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.35em] text-accent uppercase">
            Juno
          </p>
          <h1 className="font-[family-name:var(--font-display)] max-w-xl text-5xl leading-[0.95] font-semibold tracking-tight md:text-6xl">
            Tap once.
            <span className="block text-muted">Earn the most.</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted">
            Juno stands in for your cards and routes each charge to the best
            rewards in real time.
          </p>
          <div className="flex flex-wrap gap-3">
            {merchants.slice(0, 3).map((m, i) => (
              <button
                key={m.id}
                type="button"
                disabled={pending}
                onClick={() => tap(m.id)}
                className={`rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-60 ${
                  i === 0 ? "animate-pulse-ring" : ""
                }`}
              >
                Tap · {m.name}
              </button>
            ))}
          </div>
          {error ? (
            <p className="text-sm text-warn">
              API error — is uvicorn running on :8000? {error}
            </p>
          ) : null}
        </div>

        <div className="animate-rise relative aspect-[1.6/1] w-full max-w-md justify-self-end overflow-hidden rounded-[28px] border border-line bg-card-face p-7 shadow-[0_30px_80px_rgba(0,0,0,0.35)] [animation-delay:120ms]">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_40%,rgba(184,242,85,0.12)_100%)]" />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="font-[family-name:var(--font-display)] text-2xl tracking-wide">
                JUNO
              </span>
              <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                virtual
              </span>
            </div>
            <div>
              <p className="text-sm text-muted">Routes to</p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-2xl">
                {last?.transaction.selected_card_name ?? "Best linked card"}
              </p>
              {last ? (
                <p className="mt-2 text-sm text-accent">
                  +{money(last.transaction.extra_value)} vs default
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  Simulate a purchase to see the pick
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="animate-rise grid gap-10 [animation-delay:180ms] md:grid-cols-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            Linked cards
          </h2>
          <p className="mt-2 text-sm text-muted">
            Loaded from the shared card-rules library.
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
                        <span className="ml-2 text-xs text-muted">default</span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {card.issuer} ···· {card.last4}
                    </p>
                  </div>
                  <p className="text-right text-sm text-accent">{card.highlight}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            Live feed
          </h2>
          <p className="mt-2 text-sm text-muted">
            Every tap shows which card won and why.
          </p>
          <ul className="mt-6 space-y-4">
            {txs.length === 0 ? (
              <li className="text-sm text-muted">No transactions yet.</li>
            ) : (
              txs.map((tx) => (
                <li key={tx.id} className="border-b border-line pb-4 last:border-0">
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

          {merchants.length > 3 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {merchants.slice(3).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={pending}
                  onClick={() => tap(m.id)}
                  className="rounded-full border border-line px-4 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  {m.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
