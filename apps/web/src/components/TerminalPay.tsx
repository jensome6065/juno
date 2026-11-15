"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { SavingsCompare } from "@/components/SavingsCompare";
import {
  StartupHints,
  classifyApiError,
} from "@/components/StartupHints";
import { api, type Merchant, type SimulateResponse } from "@/lib/api";
import { money } from "@/lib/format";
import { playNfcTapSound, unlockNfcAudio } from "@/lib/nfcSound";

type Phase = "idle" | "waiting" | "reading" | "approved" | "error";

export function TerminalPay() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    api
      .merchants()
      .then((list) => {
        setMerchants(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase("error");
      });
  }, []);

  const merchant = merchants.find((m) => m.id === selectedId) ?? null;

  function startTap(replay = false) {
    if (!merchant || pending) return;
    setError(null);
    if (!replay) setResult(null);
    setPhase("waiting");

    const nextAuthId =
      replay && authId ? authId : `demo_auth_${Date.now().toString(36)}`;

    // Unlock audio on the user gesture so the delayed NFC beep can play.
    void unlockNfcAudio();
    const nfcTimer = window.setTimeout(() => {
      void playNfcTapSound();
    }, 1500);

    startTransition(async () => {
      try {
        await wait(700);
        setPhase("reading");
        await wait(900);
        const res = await api.simulate(merchant.id, undefined, nextAuthId);
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

  function reset() {
    setPhase("idle");
    setResult(null);
    setError(null);
    setAuthId(null);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#070b09]">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6">
        <Link
          href="/"
          className="text-sm text-muted transition hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.3em] text-accent uppercase">
          Juno Terminal
        </p>
      </div>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
        <div className="animate-rise overflow-hidden rounded-[32px] border border-line bg-[#101814] shadow-[0_40px_100px_rgba(0,0,0,0.55)]">
          <div className="border-b border-line px-6 py-4 text-xs tracking-[0.25em] text-muted uppercase">
            Merchant reader · demo
          </div>

          <div className="space-y-8 px-6 py-10 text-center md:px-10">
            <div>
              <label className="text-sm text-muted">Charge at</label>
              <select
                className="mt-2 w-full appearance-none rounded-2xl border border-line bg-[#0c1210] px-4 py-3 text-center text-lg outline-none focus:border-accent"
                value={selectedId}
                disabled={phase === "waiting" || phase === "reading"}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  reset();
                }}
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-sm text-muted">Amount due</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-6xl tracking-tight md:text-7xl">
                {merchant ? money(merchant.typical_amount) : "—"}
              </p>
              {merchant ? (
                <p className="mt-2 text-sm text-muted">
                  MCC {merchant.mcc} · {merchant.category}
                </p>
              ) : null}
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
                    <span className="rounded-full border border-accent/40 px-2.5 py-0.5 text-xs text-accent">
                      auth-bound
                    </span>
                    {result.idempotent_replay ? (
                      <span className="rounded-full border border-warn/40 px-2.5 py-0.5 text-xs text-warn">
                        idempotent
                      </span>
                    ) : null}
                  </div>
                  <p className="font-[family-name:var(--font-display)] text-2xl">
                    {result.transaction.selected_card_name}
                  </p>
                  <p className="text-sm text-muted">{result.transaction.reason}</p>
                  {result.wallet_updated ? (
                    <p className="text-sm text-muted">
                      Apple Wallet pass updated with this route.
                    </p>
                  ) : null}
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
                  disabled={!merchant || pending}
                  onClick={startTap}
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
                    onClick={reset}
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
                  {blocked ? (
                    <span className="ml-2 text-xs text-warn">
                      blocked
                      {score.constraint ? `:${score.constraint}` : ""}
                    </span>
                  ) : null}
                  {score.cap_split ? (
                    <span className="ml-2 text-xs text-accent">cap split</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted">{score.reason}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={winner && !blocked ? "text-accent" : ""}>
                  {blocked ? "—" : money(score.value)}
                </p>
                {!blocked ? (
                  <p className="mt-1 text-xs text-muted">
                    {Number(score.rate_used)}x
                  </p>
                ) : null}
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
              : "bg-[#0c1210]"
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
