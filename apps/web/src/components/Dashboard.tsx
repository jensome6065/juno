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
import { SiteNav } from "@/components/SiteNav";
import {
  StartupHints,
  classifyApiError,
} from "@/components/StartupHints";
import { TrustBadge } from "@/components/TrustBadge";
import { WalletStatus } from "@/components/WalletStatus";

type Panel = "activity" | "cards" | "caps";

const HISTORY_PREVIEW = 5;

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
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [capPulse, setCapPulse] = useState(0);
  const [decisionPulse, setDecisionPulse] = useState(false);
  const [panel, setPanel] = useState<Panel>("activity");
  const [showAllTxs, setShowAllTxs] = useState(false);

  function refreshCaps() {
    api
      .caps()
      .then((next) => {
        setCaps(next);
        setCapPulse((n) => n + 1);
      })
      .catch(() => {});
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
          setFlashIds(new Set());
          api.cards().then(setCards).catch(() => {});
          api.walletStatus().then(setWallet).catch(() => {});
          refreshCaps();
          return;
        }
        if (event.type === "decision.created" && event.transaction) {
          const tx = event.transaction;
          setTxs((prev) => {
            if (prev.some((row) => row.id === tx.id)) return prev;
            return [tx, ...prev];
          });
          setPanel("activity");
          setDecisionPulse(true);
          window.setTimeout(() => setDecisionPulse(false), 1400);
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.add(tx.id);
            return next;
          });
          window.setTimeout(() => {
            setFlashIds((prev) => {
              const next = new Set(prev);
              next.delete(tx.id);
              return next;
            });
          }, 1200);
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
  const lastTx = txs[0] ?? null;
  const visibleTxs = showAllTxs ? txs : txs.slice(0, HISTORY_PREVIEW);

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
      <SiteNav active="dashboard" live={live} />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 md:gap-10 md:py-10">
        <header className="animate-rise grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm tracking-[0.2em] text-muted uppercase">
                Your Juno
              </p>
              <TrustBadge live={live} />
            </div>

            <div>
              <p className="text-sm text-muted">Extra earned vs 1%</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-5xl leading-none tracking-tight text-accent md:text-6xl">
                {money(extraTotal)}
              </p>
              <p className="mt-3 text-sm text-muted">
                {money(spendTotal)} routed · {cards.length} cards
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/terminal"
                className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
              >
                Open tap terminal
              </Link>
              <WalletStatus
                compact
                wallet={wallet}
                pending={pending}
                error={walletError}
                onAdd={addToWallet}
              />
            </div>

            {error ? (
              <StartupHints kind={classifyApiError(error)} detail={error} />
            ) : null}
            {!error && live === "offline" ? (
              <StartupHints kind="live-offline" />
            ) : null}
          </div>

          <JunoSmartCard />
        </header>

        <DecisionPipeline
          tx={lastTx}
          cardCount={cards.length}
          pulse={decisionPulse}
        />

        <section className="animate-rise [animation-delay:100ms]">
          <div
            role="tablist"
            aria-label="Dashboard panels"
            className="flex flex-wrap gap-2 border-b border-line pb-3"
          >
            {(
              [
                ["activity", "Activity", txs.length],
                ["cards", "Cards", cards.length],
                ["caps", "Caps", null],
              ] as const
            ).map(([id, label, count]) => {
              const active = panel === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPanel(id)}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    active
                      ? "bg-accent text-accent-ink"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                  {count != null ? (
                    <span className={active ? "opacity-70" : ""}>
                      {" "}
                      · {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="min-h-[220px] pt-6" role="tabpanel">
            {panel === "activity" ? (
              <ActivityPanel
                txs={visibleTxs}
                total={txs.length}
                flashIds={flashIds}
                showAll={showAllTxs}
                onToggleAll={() => setShowAllTxs((v) => !v)}
                previewLimit={HISTORY_PREVIEW}
              />
            ) : null}

            {panel === "cards" ? (
              <CardsPanel cards={cards} error={error} />
            ) : null}

            {panel === "caps" ? (
              <CapMeters caps={caps} pulseKey={capPulse} embedded />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function DecisionPipeline({
  tx,
  cardCount,
  pulse,
}: {
  tx: Transaction | null;
  cardCount: number;
  pulse: boolean;
}) {
  const category = tx?.category ?? null;
  const resolved =
    tx == null
      ? "Merchant + MCC"
      : tx.category_source === "override"
        ? `${category} (override)`
        : category ?? "category";
  const scored =
    tx == null
      ? `${cardCount || "your"} cards`
      : `${cardCount || "all"} cards ranked`;
  const routed = tx?.selected_card_name ?? "Best rewards card";
  const updated =
    tx == null
      ? "Wallet + live feed"
      : tx.extra_value > 0
        ? `+${money(tx.extra_value)} · Wallet`
        : "Wallet + feed";

  const steps = [
    { key: "resolve", label: "Resolve", detail: resolved },
    { key: "score", label: "Score", detail: scored },
    { key: "route", label: "Route", detail: routed },
    { key: "update", label: "Update", detail: updated },
  ] as const;

  return (
    <section
      className={`animate-rise rounded-2xl bg-panel/60 px-4 py-4 ring-1 ring-white/5 [animation-delay:80ms] md:px-5 ${
        pulse ? "animate-flash-row" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          {tx ? "Last decision" : "At every tap"}
        </p>
        {tx ? (
          <p className="text-sm text-muted">
            {tx.merchant_name} · {money(tx.amount)}
          </p>
        ) : (
          <p className="text-sm text-muted">
            One virtual card becomes the best rewards card
          </p>
        )}
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.key} className="min-w-0">
            <p className="text-[10px] tracking-[0.2em] text-accent uppercase">
              {String(index + 1).padStart(2, "0")} {step.label}
            </p>
            <p className="mt-1.5 truncate font-[family-name:var(--font-display)] text-base text-foreground">
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ActivityPanel({
  txs,
  total,
  flashIds,
  showAll,
  onToggleAll,
  previewLimit,
}: {
  txs: Transaction[];
  total: number;
  flashIds: Set<string>;
  showAll: boolean;
  onToggleAll: () => void;
  previewLimit: number;
}) {
  if (total === 0) return <EmptyHistoryCta />;

  return (
    <div>
      <ul className="space-y-1">
        {txs.map((tx) => (
          <li
            key={tx.id}
            className={`border-b border-line px-2 py-3 last:border-0 ${
              flashIds.has(tx.id) ? "animate-flash-row" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{tx.merchant_name}</p>
                <p className="mt-1 truncate text-sm text-muted">
                  {tx.selected_card_name}
                  {tx.category_source === "override" ? (
                    <span className="text-accent"> · override</span>
                  ) : null}
                  {tx.cap_key ? (
                    <span className="text-accent"> · cap {tx.cap_key}</span>
                  ) : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm">{money(tx.amount)}</p>
                <p className="mt-0.5 text-sm text-accent">
                  +{money(tx.extra_value)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {total > previewLimit ? (
        <button
          type="button"
          onClick={onToggleAll}
          className="mt-4 text-sm text-accent transition hover:brightness-110"
        >
          {showAll ? "Show less" : `View all ${total} routes`}
        </button>
      ) : null}
    </div>
  );
}

function CardsPanel({
  cards,
  error,
}: {
  cards: Card[];
  error: string | null;
}) {
  if (!error && cards.length === 0) {
    return <StartupHints kind="empty-cards" />;
  }

  return (
    <ul className="space-y-4">
      {cards.map((card) => (
        <li key={card.id} className="border-b border-line pb-4 last:border-0">
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
  );
}

function EmptyHistoryCta() {
  return (
    <div className="border border-line/80 bg-background/40 px-5 py-6 text-left">
      <p className="font-[family-name:var(--font-display)] text-xl">
        No routed purchases yet
      </p>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Simulate a merchant tap. This feed updates live when a decision lands.
      </p>
      <Link
        href="/terminal"
        className="mt-5 inline-flex rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
      >
        Open tap terminal
      </Link>
    </div>
  );
}
