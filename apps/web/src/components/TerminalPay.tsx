"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
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

/** Pitch-friendly shortcuts: teach override / rotating / cap burn without the full select. */
const PITCH_CHIPS: {
  id: string;
  tag: string;
  shortName: string;
  hint: string;
}[] = [
  { id: "starbucks", tag: "Dining", shortName: "Starbucks", hint: "Gold 4x" },
  { id: "shell", tag: "Gas", shortName: "Shell", hint: "Flex 5x" },
  {
    id: "whole_foods",
    tag: "Cap",
    shortName: "Whole Foods",
    hint: "Gold after Flex",
  },
  {
    id: "starbucks_whole_foods",
    tag: "Override",
    shortName: "SBX @ WF",
    hint: "MCC to dining",
  },
  { id: "cvs", tag: "Drug", shortName: "CVS", hint: "Flex 3x" },
  {
    id: "best_buy",
    tag: "Other",
    shortName: "Best Buy",
    hint: "Double Cash",
  },
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
  const [moreMerchants, setMoreMerchants] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [pending, startTransition] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);
  const carryMonths = financeMode ? 12 : 0;

  const showResult = phase === "approved" && result;
  const collapsed = Boolean(showResult);

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

  useEffect(() => {
    if (phase === "approved" && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase, result]);

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
  const activeChip =
    mode === "catalog"
      ? pitchChips.find((chip) => chip.id === selectedId)
      : null;

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
    <div className="flex min-h-full flex-1 flex-col">
      <SiteNav active="terminal" live={live} />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8">
        <div className="animate-rise overflow-hidden rounded-[2rem] bg-gradient-to-b from-[#151a16] to-[#0d100e] shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
          <div className="px-6 pt-5 text-center text-[10px] tracking-[0.3em] text-muted/80 uppercase">
            Merchant reader
          </div>

          <div className="px-6 pb-7 pt-4 text-center">
            {collapsed && result ? (
              <button
                type="button"
                onClick={resetOutcome}
                className="mb-6 w-full rounded-2xl bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.05]"
              >
                <p className="text-xs tracking-[0.2em] text-muted uppercase">
                  This tap
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {result.transaction.merchant_name} ·{" "}
                  {money(result.transaction.amount)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Tap to change merchant or amount
                </p>
              </button>
            ) : (
              <div className="mb-1">
                <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
                  {pitchChips.map((chip, index) => {
                    const active =
                      mode === "catalog" && selectedId === chip.id;
                    return (
                      <span key={chip.id} className="inline-flex items-center">
                        {index > 0 ? (
                          <span className="mx-0.5 text-muted/30" aria-hidden>
                            /
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          title={`${chip.shortName} · ${chip.hint}`}
                          onClick={() => selectMerchant(chip.id)}
                          className={`px-1.5 py-1 text-sm transition disabled:opacity-50 ${
                            active
                              ? "text-accent"
                              : "text-muted hover:text-foreground"
                          }`}
                        >
                          {chip.shortName}
                        </button>
                      </span>
                    );
                  })}
                </div>

                <p className="mt-2 text-xs text-muted">
                  {infer ? (
                    <span className="text-accent">{infer.category}</span>
                  ) : (
                    "pick a place"
                  )}
                  {activeChip ? ` · ${activeChip.hint}` : null}
                </p>

                {(moreMerchants || advancedOpen) && (
                  <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                    {moreMerchants ? (
                      <div className="space-y-3">
                        <div className="flex justify-center gap-4 text-xs">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setMode("catalog");
                              resetOutcome();
                            }}
                            className={
                              mode === "catalog" ? "text-accent" : "text-muted"
                            }
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
                            className={
                              mode === "custom" ? "text-accent" : "text-muted"
                            }
                          >
                            Free text
                          </button>
                        </div>

                        {mode === "catalog" ? (
                          <select
                            className="w-full appearance-none rounded-xl bg-white/[0.03] px-3 py-2.5 text-center text-sm outline-none focus:bg-white/[0.05]"
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
                        ) : (
                          <div className="grid gap-2 text-left sm:grid-cols-2">
                            <label className="block text-xs text-muted sm:col-span-2">
                              Merchant name
                              <input
                                className="mt-1 w-full rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm text-foreground outline-none focus:bg-white/[0.05]"
                                value={customName}
                                disabled={busy}
                                placeholder="Starbucks at Whole Foods"
                                onChange={(e) => {
                                  setCustomName(e.target.value);
                                  resetOutcome();
                                }}
                              />
                            </label>
                            <label className="block text-xs text-muted">
                              MCC
                              <input
                                className="mt-1 w-full rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm text-foreground outline-none focus:bg-white/[0.05]"
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
                      </div>
                    ) : null}

                    {advancedOpen ? (
                      <label className="flex cursor-pointer items-center justify-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-[var(--accent)]"
                          checked={financeMode}
                          disabled={busy}
                          onChange={(e) => {
                            setFinanceMode(e.target.checked);
                            resetOutcome();
                          }}
                        />
                        <span>Finance mode · Reflect 0% APR / 12 mo</span>
                      </label>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {!collapsed ? (
              <div className="mt-8 flex flex-col items-center">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-[family-name:var(--font-display)] text-3xl text-muted/70">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={busy}
                    value={amountInput}
                    size={Math.max(4, amountInput.length)}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d.]/g, "");
                      setAmountInput(next);
                      resetOutcome();
                    }}
                    className="max-w-[min(100%,18rem)] bg-transparent text-center font-[family-name:var(--font-display)] text-5xl tracking-tight outline-none tabular-nums md:text-6xl"
                    style={{
                      width: `${Math.max(5, amountInput.length + 1)}ch`,
                      fieldSizing: "content",
                    }}
                  />
                </div>
                {!amountOk ? (
                  <p className="mt-2 text-xs text-warn">
                    Enter an amount over $0
                  </p>
                ) : null}

                <div className="mt-8">
                  <TapStage phase={phase} />
                </div>
              </div>
            ) : null}

            {showResult ? (
              <div
                ref={resultRef}
                className="animate-rise mt-2 space-y-4 text-left"
              >
                <div className="flex flex-col items-center gap-2 pb-1 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <span className="font-[family-name:var(--font-display)] text-xs tracking-wide">
                      OK
                    </span>
                  </div>
                  <p className="text-sm text-accent">
                    {result.idempotent_replay
                      ? "Same charge can’t route twice"
                      : "Approved"}
                    {typeof result.latency_ms === "number"
                      ? ` · ${formatLatency(result.latency_ms)}`
                      : null}
                  </p>
                </div>

                <div className="space-y-1.5 text-center">
                  <p className="font-[family-name:var(--font-display)] text-2xl">
                    {result.transaction.selected_card_name}
                  </p>
                  <p className="text-sm text-muted">
                    {result.transaction.reason}
                  </p>
                  {result.transaction.extra_value > 0 ? (
                    <p className="font-[family-name:var(--font-display)] text-xl text-accent">
                      +{money(result.transaction.extra_value)}
                    </p>
                  ) : null}
                </div>

                <p className="text-center text-xs tracking-wide text-muted">
                  {result.idempotent_replay
                    ? "Verified tap · duplicate route blocked"
                    : "Verified tap · card numbers never leave the vault"}
                </p>

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
              <div className="mt-6">
                <StartupHints kind={classifyApiError(error)} detail={error} />
              </div>
            ) : null}
            {phase !== "error" && merchants.length === 0 ? (
              <div className="mt-6">
                <StartupHints kind="no-merchants" />
              </div>
            ) : null}

            <div className="mt-8 flex flex-col items-center gap-3">
              {phase === "idle" || phase === "error" ? (
                <button
                  type="button"
                  disabled={!canTap}
                  onClick={() => startTap()}
                  className="w-full max-w-xs rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
                >
                  Hold phone to reader
                </button>
              ) : null}
              {phase === "approved" ? (
                <div className="flex w-full max-w-xs flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={resetOutcome}
                    className="flex-1 rounded-full px-6 py-3 text-sm text-muted transition hover:text-foreground"
                  >
                    New tap
                  </button>
                  <Link
                    href="/"
                    className="flex-1 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
                  >
                    Dashboard
                  </Link>
                </div>
              ) : null}

              {!collapsed ? (
                <div className="flex items-center gap-3 text-xs text-muted/70">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMoreMerchants((open) => !open)}
                    className="transition hover:text-muted disabled:opacity-50"
                  >
                    {moreMerchants ? "Less" : "More"}
                  </button>
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAdvancedOpen((open) => !open)}
                    className="transition hover:text-muted disabled:opacity-50"
                  >
                    {advancedOpen ? "Hide advanced" : "Advanced"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!authId || pending}
                  onClick={() => startTap(true)}
                  className="text-xs text-muted/70 transition hover:text-muted disabled:opacity-50"
                >
                  Try replay to prove it can’t double-route
                </button>
              )}
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
      "Winner hit a bonus cap; part of the purchase earned the default rate",
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
    <div className="border-t border-line/80 pt-3">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Why this category / rate
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-muted">
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
    <div className="border-t border-line/80 pt-3">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Router decision
      </p>
      <ul className="mt-2 space-y-2">
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
                <p className="mt-0.5 text-xs text-muted">{score.reason}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={winner && !blocked ? "text-accent" : ""}>
                  {blocked ? "-" : money(score.value)}
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
        : phase === "error"
          ? "Declined"
          : "Ready for tap";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full ${
          phase === "waiting" || phase === "reading"
            ? "animate-pulse-ring bg-accent/15"
            : "bg-white/[0.04]"
        }`}
      >
        <span className="font-[family-name:var(--font-display)] text-xs tracking-[0.2em]">
          NFC
        </span>
      </div>
      <p className="text-xs text-muted">{label}</p>
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
