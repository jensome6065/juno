"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  api,
  type CapStatus,
  type Card,
  type DecisionEvent,
  type Transaction,
  type WalletStatus as WalletStatusData,
} from "@/lib/api";
import { money } from "@/lib/format";
import { CapMeters } from "@/components/CapMeters";
import { JunoSmartCard } from "@/components/JunoSmartCard";
import { SavingsCompare } from "@/components/SavingsCompare";
import { SecurityPanel } from "@/components/SecurityPanel";
import { SiteNav } from "@/components/SiteNav";
import {
  StartupHints,
  classifyApiError,
} from "@/components/StartupHints";
import { WalletStatus } from "@/components/WalletStatus";

export function Dashboard() {
  const [cards, setCards] = useState<Card[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [caps, setCaps] = useState<CapStatus | null>(null);
  const [wallet, setWallet] = useState<WalletStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [live, setLive] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [pending, startTransition] = useTransition();

  function refreshCaps() {
    api.caps().then(setCaps).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      api.cards(),
      api.transactions(),
      api.walletStatus(),
      api.caps(),
    ])
      .then(([c, t, w, capStatus]) => {
        setCards(c);
        setTxs(t);
        setWallet(w);
        setCaps(capStatus);
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
        if (event.type === "demo.reset") {
          setTxs([]);
          api.cards().then(setCards).catch(() => {});
          api.walletStatus().then(setWallet).catch(() => {});
          refreshCaps();
          return;
        }
        if (event.type === "decision.created" && event.transaction) {
          setTxs((prev) => {
            if (prev.some((tx) => tx.id === event.transaction!.id)) return prev;
            return [event.transaction!, ...prev];
          });
          api.cards().then(setCards).catch(() => {});
          refreshCaps();
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, []);

  const extraTotal = txs.reduce((sum, tx) => sum + tx.extra_value, 0);
  const spendTotal = txs.reduce((sum, tx) => sum + tx.amount, 0);

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

  function resetDemo() {
    if (
      !window.confirm(
        "Clear spam taps and load a varied pitch history (coffee, gas, grocery, flight, …)?",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Wipe + seed distinct merchants so the feed isn’t 6× Blue Bottle.
        await api.runDemoScript(true);
        const [c, w, seeded, capStatus] = await Promise.all([
          api.cards(),
          api.walletStatus(),
          api.transactions(),
          api.caps(),
        ]);
        setCards(c);
        setWallet(w);
        setTxs(seeded);
        setCaps(capStatus);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reset failed");
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteNav active="dashboard" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 py-10 md:py-14">
        <header className="animate-rise grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-center">
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
                  className="rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10"
                >
                  Apple Wallet
                </a>
              ) : (
                <button
                  type="button"
                  disabled={pending || wallet?.configured === false}
                  onClick={addToWallet}
                  className="rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-50"
                >
                  {pending ? "Creating pass…" : "Add to Apple Wallet"}
                </button>
              )}
              {wallet?.google_save_url ? (
                <a
                  href={wallet.google_save_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10"
                >
                  Google Wallet
                </a>
              ) : null}
            </div>
            <WalletStatus
              wallet={wallet}
              pending={pending}
              error={walletError}
              onAdd={addToWallet}
            />
            {error ? (
              <StartupHints kind={classifyApiError(error)} detail={error} />
            ) : null}
            {!error && live === "offline" ? (
              <StartupHints kind="live-offline" />
            ) : null}
          </div>

          <JunoSmartCard />
        </header>

        <section className="animate-rise grid gap-4 sm:grid-cols-3 [animation-delay:140ms]">
          <Stat label="Extra earned" value={money(extraTotal)} />
          <Stat label="Routed spend" value={money(spendTotal)} />
          <Stat label="Linked cards" value={String(cards.length)} />
        </section>

        <div className="animate-rise [animation-delay:150ms]">
          <CapMeters caps={caps} />
        </div>

        <section className="animate-rise border-t border-line pt-10 [animation-delay:160ms]">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">
            How Juno decides
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            At authorization time, one virtual card becomes the best linked
            rewards card for that purchase — then the Wallet pass reflects it.
          </p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <DecideStep
              n="01"
              title="Resolve"
              body="Map MCC + merchant name. Overrides catch coffee ringing as grocery."
            />
            <DecideStep
              n="02"
              title="Score"
              body="Rank every linked card with rates, caps, and APR constraints."
            />
            <DecideStep
              n="03"
              title="Route"
              body="Pick the winner once per authorization id — replays stay idempotent."
            />
            <DecideStep
              n="04"
              title="Update"
              body="Stream the decision to this dashboard and refresh the Wallet pass."
            />
          </ol>
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
              {!error && cards.length === 0 ? (
                <li>
                  <StartupHints kind="empty-cards" />
                </li>
              ) : (
                cards.map((card) => (
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
                ))
              )}
            </ul>
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-2xl">
                  Transaction history
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Live from the terminal — routed rewards vs a flat 1% baseline.
                </p>
              </div>
              <button
                type="button"
                disabled={pending || txs.length === 0}
                onClick={resetDemo}
                className="rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-warn hover:text-warn disabled:opacity-40"
              >
                Reset & seed pitch
              </button>
            </div>
            <ul className="mt-6 space-y-4">
              {txs.length === 0 ? (
                <li>
                  <StartupHints kind="empty-history" />
                </li>
              ) : (
                txs.map((tx) => (
                  <li
                    key={tx.id}
                    className="border-b border-line pb-4 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium">{tx.merchant_name}</p>
                        <p className="mt-1 text-sm text-muted">{tx.reason}</p>
                        {(tx.category_source === "override" ||
                          tx.cap_key) && (
                          <p className="mt-1 text-xs text-accent">
                            {tx.category_source === "override"
                              ? `Override → ${tx.category}`
                              : null}
                            {tx.category_source === "override" && tx.cap_key
                              ? " · "
                              : null}
                            {tx.cap_key
                              ? `Cap “${tx.cap_key}” applied`
                              : null}
                          </p>
                        )}
                        <SavingsCompare
                          compact
                          defaultCardName={tx.default_card_name}
                          selectedCardName={tx.selected_card_name}
                          defaultRewardValue={tx.default_reward_value}
                          rewardValue={tx.reward_value}
                          extraValue={tx.extra_value}
                        />
                      </div>
                      <div className="shrink-0 text-right">
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

function DecideStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="border-t border-line pt-4">
      <p className="text-xs tracking-[0.2em] text-accent uppercase">{n}</p>
      <p className="mt-3 font-[family-name:var(--font-display)] text-xl">
        {title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </li>
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
