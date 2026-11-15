"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  api,
  type Card,
  type DecisionEvent,
  type Transaction,
  type WalletStatus,
} from "@/lib/api";
import { money } from "@/lib/format";
import { SecurityPanel } from "@/components/SecurityPanel";
import { SiteNav } from "@/components/SiteNav";

export function Dashboard() {
  const [cards, setCards] = useState<Card[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [live, setLive] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    Promise.all([api.cards(), api.transactions(), api.walletStatus()])
      .then(([c, t, w]) => {
        setCards(c);
        setTxs(t);
        setWallet(w);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const source = new EventSource(api.eventsUrl());

    source.onopen = () => setLive("live");
    source.onerror = () => setLive("offline");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as DecisionEvent;
        if (event.type === "connected") {
          setLive("live");
          return;
        }
        if (event.type === "decision.created" && event.transaction) {
          setTxs((prev) => {
            if (prev.some((tx) => tx.id === event.transaction!.id)) return prev;
            return [event.transaction!, ...prev];
          });
          api.cards().then(setCards).catch(() => {});
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, []);

  const extraTotal = txs.reduce((sum, tx) => sum + tx.extra_value, 0);
  const spendTotal = txs.reduce((sum, tx) => sum + tx.amount, 0);
  const last = txs[0] ?? null;

  function addToWallet() {
    setWalletError(null);
    startTransition(async () => {
      try {
        const pass = await api.createWalletPass();
        setWallet({
          configured: true,
          serial_number: pass.serial_number,
          share_url: pass.share_url,
          google_save_url: pass.google_save_url,
        });
        if (pass.share_url) {
          window.open(pass.share_url, "_blank", "noopener,noreferrer");
        }
      } catch (e) {
        setWalletError(e instanceof Error ? e.message : "Could not create pass");
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteNav active="dashboard" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 py-10 md:py-14">
        <header className="animate-rise grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm tracking-[0.2em] text-muted uppercase">
                Account
              </p>
              <LiveBadge state={live} />
            </div>
            <h1 className="font-[family-name:var(--font-display)] max-w-xl text-5xl leading-[0.95] font-semibold tracking-tight md:text-6xl">
              Your Juno
              <span className="block text-muted">wallet dashboard</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted">
              Add Juno to Apple Wallet, then use the terminal to simulate a tap.
              After each route, the Wallet pass updates with which card won.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/terminal"
                className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
              >
                Open tap terminal
              </Link>
              {wallet?.share_url ? (
                <a
                  href={wallet.share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="animate-pulse-ring rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10"
                >
                  Open Apple Wallet pass
                </a>
              ) : (
                <button
                  type="button"
                  disabled={pending || wallet?.configured === false}
                  onClick={addToWallet}
                  className="animate-pulse-ring rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-50"
                >
                  {pending ? "Creating pass…" : "Add to Apple Wallet"}
                </button>
              )}
            </div>
            {wallet && !wallet.configured ? (
              <p className="text-sm text-warn">
                Set <code className="text-foreground">WALLETWALLET_API_KEY</code>{" "}
                in <code className="text-foreground">.env</code> from{" "}
                <a
                  className="underline"
                  href="https://www.walletwallet.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  walletwallet.dev
                </a>
                , then restart the API.
              </p>
            ) : null}
            {walletError ? <p className="text-sm text-warn">{walletError}</p> : null}
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
                  {wallet?.serial_number ? "in wallet" : "virtual card"}
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
              Live from the terminal — which card won, why, and how much more
              you earned.
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

        <SecurityPanel live={live} />
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

function LiveBadge({
  state,
}: {
  state: "connecting" | "live" | "offline";
}) {
  const label =
    state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  const color =
    state === "live"
      ? "border-accent/40 text-accent"
      : state === "connecting"
        ? "border-line text-muted"
        : "border-warn/40 text-warn";

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs tracking-wide ${color}`}
    >
      {label}
    </span>
  );
}
