"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { SavingsCompare } from "@/components/SavingsCompare";
import { SiteNav } from "@/components/SiteNav";
import {
  StartupHints,
  classifyApiError,
} from "@/components/StartupHints";
import {
  api,
  type InferResponse,
  type Merchant,
  type SimulateResponse,
} from "@/lib/api";
import { money } from "@/lib/format";
import { playNfcTapSound, unlockNfcAudio } from "@/lib/nfcSound";

type Phase = "idle" | "waiting" | "reading" | "approved" | "error";

/** Pitch-friendly shortcuts — teach override / rotating / cap burn without the full select. */
const PITCH_CHIPS: {
  id: string;
  tag: string;
  hint: string;
}[] = [
  { id: "starbucks", tag: "Dining", hint: "Amex Gold 4x" },
  { id: "shell", tag: "Gas / rotating", hint: "Freedom Flex 5x" },
  { id: "whole_foods", tag: "Cap burn", hint: "Gold after Flex full" },
  {
    id: "starbucks_whole_foods",
    tag: "Override",
    hint: "MCC grocery → dining",
  },
  { id: "cvs", tag: "Drugstore", hint: "Flex 3x" },
  { id: "best_buy", tag: "Catch-all", hint: "Double Cash 2%" },
];

export function TerminalPay() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [selectedId, setSelectedId] = useState("");
  const [customName, setCustomName] = useState("");
  const [customMcc, setCustomMcc] = useState("5814");
  const [amountInput, setAmountInput] = useState("6.50");
  const [infer, setInfer] = useState<InferResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [financeMode, setFinanceMode] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [pending, startTransition] = useTransition();
  const carryMonths = financeMode ? 12 : 0;

  useEffect(() => {
    api
      .merchants()
      .then((list) => {
        setMerchants(list);
        const firstPitch = PITCH_CHIPS.find((chip) =>
          list.some((m) => m.id === chip.id),
        );
        const first = list.find((m) => m.id === firstPitch?.id) ?? list[0];
        if (first) {
          setSelectedId(first.id);
          setAmountInput(first.typical_amount.toFixed(2));
        }
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase("error");
      });
  }, []);

  useEffect(() => {
    const source = new EventSource(api.eventsUrl());
    source.onopen = () => setLive("live");
    source.onerror = () => setLive("offline");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (event.type === "connected" || event.type === "decision.created") {
          setLive("live");
        }
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);

  const merchant = merchants.find((m) => m.id === selectedId) ?? null;
  const pitchChips = PITCH_CHIPS.filter((chip) =>
    merchants.some((m) => m.id === chip.id),
  );
  const amountValue = Number.parseFloat(amountInput);
  const amountOk = Number.isFinite(amountValue) && amountValue > 0;
  const customOk =
    customName.trim().length > 0 && /^\d{3,8}$/.test(customMcc.trim());
  const canTap =
    amountOk &&
    (mode === "catalog" ? Boolean(merchant) : customOk) &&
    !pending;

  const previewName =
    mode === "catalog" ? (merchant?.name ?? "") : customName.trim();
  const previewMcc =
    mode === "catalog" ? (merchant?.mcc ?? "") : customMcc.trim();

  function selectMerchant(id: string) {
    setMode("catalog");
    setSelectedId(id);
    const found = merchants.find((m) => m.id === id);
    if (found) setAmountInput(found.typical_amount.toFixed(2));
    resetOutcome();
  }

  useEffect(() => {
    if (!previewName || !previewMcc) {
      setInfer(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api
        .infer(previewName, previewMcc)
        .then(setInfer)
        .catch(() => setInfer(null));
    }, 120);
    return () => window.clearTimeout(handle);
  }, [previewName, previewMcc]);

  function resetOutcome() {
    setPhase("idle");
    setResult(null);
    setError(null);
    setAuthId(null);
  }

  function startTap(replay = false) {
    if (!canTap && !replay) return;
    if (replay && (!authId || !amountOk)) return;
    setError(null);
    if (!replay) setResult(null);
    setPhase("waiting");

    const nextAuthId =
      replay && authId ? authId : `demo_auth_${Date.now().toString(36)}`;

    void unlockNfcAudio();
    const nfcTimer = window.setTimeout(() => {
      void playNfcTapSound();
    }, 1500);

    startTransition(async () => {
      try {
        await wait(700);
        setPhase("reading");
        await wait(900);
        const res =
          mode === "catalog" && merchant
            ? await api.simulate(
                merchant.id,
                amountValue,
                nextAuthId,
                carryMonths,
              )
            : await api.simulateFreeText({
                merchant_name: customName.trim(),
                mcc: customMcc.trim(),
                amount: amountValue,
                authorization_id: nextAuthId,
                carry_months: carryMonths,
              });
        setAuthId(res.authorization_id ?? nextAuthId);
        setResult(res);
        setPhase("approved");
      } catch (e) {
        window.clearTimeout(nfcTimer);
        setError(e instanceof Error ? e.message : "Payment failed");
        setPhase("error");
      }
    });
  }

  const busy = phase === "waiting" || phase === "reading";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteNav active="terminal" live={live} />

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
        <div className="animate-rise overflow-hidden rounded-[32px] border border-line bg-[#101814] shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
          <div className="border-b border-line px-6 py-4 text-xs tracking-[0.25em] text-muted uppercase">
            Merchant reader · top places
          </div>

          <div className="space-y-8 px-6 py-10 text-center md:px-10">
            <div>
              <p className="text-sm text-muted">Pitch taps</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {pitchChips.map((chip) => {
                  const active = selectedId === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      disabled={busy}
                      onClick={() => selectMerchant(chip.id)}
                      className={`rounded-full border px-3 py-2 text-left transition disabled:opacity-50 ${
                        active
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line text-muted hover:border-accent hover:text-foreground"
                      }`}
                    >
                      <span className="block text-xs tracking-wide uppercase">
                        {chip.tag}
                      </span>
                      <span className="mt-0.5 block text-sm text-foreground">
                        {merchants.find((m) => m.id === chip.id)?.name ?? chip.id}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {chip.hint}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 flex justify-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("catalog");
                    resetOutcome();
                  }}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    mode === "catalog"
                      ? "border-accent text-accent"
                      : "border-line text-muted hover:text-foreground"
                  }`}
                >
                  Catalog
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("custom");
                    resetOutcome();
                  }}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    mode === "custom"
                      ? "border-accent text-accent"
                      : "border-line text-muted hover:text-foreground"
                  }`}
                >
                  Free text
                </button>
              </div>

              {mode === "catalog" ? (
                <>
                  <label className="mt-4 block text-sm text-muted">
                    Or pick any merchant
                  </label>
                  <select
                    className="mt-2 w-full appearance-none rounded-2xl border border-line bg-background px-4 py-3 text-center text-lg outline-none focus:border-accent"
                    value={selectedId}
                    disabled={busy || merchants.length === 0}
                    onChange={(e) => selectMerchant(e.target.value)}
                  >
                    {merchants.length === 0 ? (
                      <option value="">Loading merchants…</option>
                    ) : (
                      merchants.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))
                    )}
                  </select>
                </>
              ) : (
                <div className="mt-4 grid gap-3 text-left sm:grid-cols-2">
                  <label className="block text-sm text-muted sm:col-span-2">
                    Merchant name
                    <input
                      className="mt-2 w-full rounded-2xl border border-line bg-background px-4 py-3 text-foreground outline-none focus:border-accent"
                      value={customName}
                      disabled={busy}
                      placeholder="Starbucks at Whole Foods"
                      onChange={(e) => {
                        setCustomName(e.target.value);
                        resetOutcome();
                      }}
                    />
                  </label>
                  <label className="block text-sm text-muted">
                    MCC
                    <input
                      className="mt-2 w-full rounded-2xl border border-line bg-background px-4 py-3 text-foreground outline-none focus:border-accent"
                      value={customMcc}
                      disabled={busy}
                      placeholder="5411"
                      onChange={(e) => {
                        setCustomMcc(e.target.value);
                        resetOutcome();
                      }}
                    />
                  </label>
                </div>
              )}

              {infer ? (
                <p className="mt-2 text-sm text-muted">
                  Inferred{" "}
                  <span className="text-accent">{infer.category}</span>
                  {" · "}
                  {infer.source}
                  {infer.source === "override" && infer.mcc_category
                    ? ` (MCC looked like ${infer.mcc_category})`
                    : null}
                </p>
              ) : previewMcc ? (
                <p className="mt-2 text-sm text-muted">MCC {previewMcc}</p>
              ) : null}
            </div>

            <div>
              <label className="text-sm text-muted">Amount due</label>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="font-[family-name:var(--font-display)] text-4xl text-muted">
                  $
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  disabled={busy}
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    resetOutcome();
                  }}
                  className="w-40 bg-transparent text-center font-[family-name:var(--font-display)] text-6xl tracking-tight outline-none md:text-7xl"
                />
              </div>
              {!amountOk ? (
                <p className="mt-2 text-sm text-warn">Enter an amount over $0</p>
              ) : null}

              <label className="mt-5 flex cursor-pointer items-center justify-center gap-3 text-sm text-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={financeMode}
                  disabled={busy}
                  onChange={(e) => {
                    setFinanceMode(e.target.checked);
                    resetOutcome();
                  }}
                />
                <span>
                  Finance mode · weigh Reflect 0% APR over 12 months
                </span>
              </label>
            </div>

            <TapStage phase={phase} />

            {phase === "approved" && result ? (
              <div className="animate-rise space-y-4 rounded-2xl border border-accent/30 bg-accent/5 px-5 py-5 text-left">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-accent">
                      {result.idempotent_replay ? "Replay blocked" : "Approved"}
                    </p>
                    {typeof result.latency_ms === "number" ? (
                      <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
                        routed in {formatLatency(result.latency_ms)}
                      </span>
                    ) : null}
                  </div>
                  <p className="font-[family-name:var(--font-display)] text-2xl">
                    {result.transaction.selected_card_name}
                  </p>
                  <p className="text-sm text-muted">{result.transaction.reason}</p>
                </div>

                <SavingsCompare
                  defaultCardName={result.transaction.default_card_name}
                  selectedCardName={result.transaction.selected_card_name}
                  defaultRewardValue={result.transaction.default_reward_value}
                  rewardValue={result.transaction.reward_value}
                  extraValue={result.transaction.extra_value}
                />

                <DecisionNotes
                  intel={result.intel}
                  transaction={result.transaction}
                />

                <ScoreBreakdown
                  scores={result.scores}
                  winnerId={result.transaction.selected_card_id}
                />
              </div>
            ) : null}

            {phase === "error" && error ? (
              <StartupHints kind={classifyApiError(error)} detail={error} />
            ) : null}
            {phase !== "error" && merchants.length === 0 ? (
              <StartupHints kind="no-merchants" />
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              {phase === "idle" || phase === "error" ? (
                <button
                  type="button"
                  disabled={!canTap}
                  onClick={() => startTap()}
                  className="rounded-full bg-accent px-8 py-4 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
                >
                  Hold phone to reader
                </button>
              ) : null}
              {phase === "approved" ? (
                <>
                  <button
                    type="button"
                    disabled={!authId || pending}
                    onClick={() => startTap(true)}
                    className="rounded-full border border-line px-8 py-4 text-sm transition hover:border-accent disabled:opacity-50"
                  >
                    Replay same auth
                  </button>
                  <button
                    type="button"
                    onClick={resetOutcome}
                    className="rounded-full border border-line px-8 py-4 text-sm transition hover:border-accent"
                  >
                    New tap
                  </button>
                  <Link
                    href="/"
                    className="rounded-full bg-accent px-8 py-4 text-sm font-semibold text-accent-ink transition hover:brightness-110"
                  >
                    View on dashboard
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function DecisionNotes({
  intel,
  transaction,
}: {
  intel: SimulateResponse["intel"];
  transaction: SimulateResponse["transaction"];
}) {
  const source = intel?.category_source ?? transaction.category_source;
  const category = intel?.category ?? transaction.category;
  const mccCategory = intel?.mcc_category;
  const notes: string[] = [];

  if (source === "override" && mccCategory && mccCategory !== category) {
    notes.push(
      `Merchant override: MCC looked like ${mccCategory}, scored as ${category}` +
        (intel?.override_id ? ` (${intel.override_id})` : ""),
    );
  } else if (source === "override") {
    notes.push(
      `Merchant override applied → ${category}` +
        (intel?.override_id ? ` (${intel.override_id})` : ""),
    );
  } else if (source === "mcc") {
    notes.push(`Category from MCC → ${category}`);
  }

  if (intel?.winner_cap_split) {
    notes.push(
      "Winner hit a bonus cap — part of the purchase earned the default rate",
    );
  } else if (transaction.cap_key && transaction.cap_remaining_cents != null) {
    notes.push(
      `Cap bucket “${transaction.cap_key}” · ${money(
        transaction.cap_remaining_cents / 100,
      )} remaining this period`,
    );
  }

  if (!notes.length) return null;

  return (
    <div className="border-t border-line/80 pt-4">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Why this category / rate
      </p>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {notes.map((note) => (
          <li key={note} className="leading-snug">
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBreakdown({
  scores,
  winnerId,
}: {
  scores: SimulateResponse["scores"];
  winnerId: string;
}) {
  if (!scores.length) return null;

  return (
    <div className="border-t border-line/80 pt-4">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Router decision
      </p>
      <ul className="mt-3 space-y-3">
        {scores.map((score, index) => {
          const winner = score.card_id === winnerId;
          const blocked = score.eligible === false;
          return (
            <li
              key={score.card_id}
              className={`flex items-start justify-between gap-3 text-sm ${
                blocked
                  ? "text-muted/70"
                  : winner
                    ? "text-foreground"
                    : "text-muted"
              }`}
            >
              <div className="min-w-0">
                <p className={winner && !blocked ? "font-medium" : ""}>
                  <span className="mr-2 text-xs text-muted">#{index + 1}</span>
                  {score.card_name}
                  {winner && !blocked ? (
                    <span className="ml-2 text-xs text-accent">selected</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted">{score.reason}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={winner && !blocked ? "text-accent" : ""}>
                  {blocked ? "—" : money(score.value)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TapStage({ phase }: { phase: Phase }) {
  const label =
    phase === "waiting"
      ? "Bring phone near reader…"
      : phase === "reading"
        ? "Reading Juno card…"
        : phase === "approved"
          ? "Routed"
          : phase === "error"
            ? "Declined"
            : "Ready for Apple Wallet tap";

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div
        className={`flex h-28 w-28 items-center justify-center rounded-full border border-line ${
          phase === "waiting" || phase === "reading"
            ? "animate-pulse-ring bg-accent/10"
            : phase === "approved"
              ? "bg-accent text-accent-ink"
              : "bg-background"
        }`}
      >
        <span className="font-[family-name:var(--font-display)] text-sm tracking-wide">
          {phase === "approved" ? "OK" : "NFC"}
        </span>
      </div>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function formatLatency(ms: number) {
  if (ms < 1) return "<1ms";
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
