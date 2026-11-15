"use client";

import Link from "next/link";
import { api } from "@/lib/api";

export type HintKind =
  | "api-down"
  | "postgres"
  | "live-offline"
  | "empty-history"
  | "empty-cards"
  | "no-merchants";

type Props = {
  kind: HintKind;
  detail?: string | null;
  className?: string;
};

const COPY: Record<
  HintKind,
  { title: string; steps: string[]; tip?: string }
> = {
  "api-down": {
    title: "API is not reachable",
    steps: [
      "From apps/api: source .venv/bin/activate",
      "uvicorn app.main:app --reload --port 8000",
      `Confirm ${api.baseUrl}/health opens in a browser`,
    ],
    tip: "Web expects NEXT_PUBLIC_API_URL to match that host.",
  },
  postgres: {
    title: "Postgres is not running",
    steps: [
      "Open Docker Desktop and wait until it is ready",
      "From the repo root: docker compose up -d db",
      "Restart uvicorn after the DB is healthy",
    ],
  },
  "live-offline": {
    title: "Live feed disconnected",
    steps: [
      "Keep uvicorn running on :8000",
      "Hard-refresh this page so EventSource reconnects",
      "Check NEXT_PUBLIC_API_URL in apps/web/.env.local or the root .env",
    ],
  },
  "empty-history": {
    title: "No routed purchases yet",
    steps: [
      "Open the tap terminal",
      "Pick a merchant (try Starbucks at Whole Foods for an override)",
      "Hold phone to reader — this list updates live over SSE",
    ],
  },
  "empty-cards": {
    title: "No linked cards loaded",
    steps: [
      "Confirm the API can read packages/card-rules",
      "Restart uvicorn, then refresh this page",
    ],
  },
  "no-merchants": {
    title: "Merchants did not load",
    steps: [
      "Start the API on :8000",
      "If you see a Postgres error, run docker compose up -d db first",
      "Refresh this page",
    ],
  },
};

export function classifyApiError(message: string | null | undefined): HintKind {
  const text = (message || "").toLowerCase();
  if (
    text.includes("connection refused") ||
    text.includes("could not connect") ||
    text.includes("operationalerror") ||
    text.includes("5432") ||
    text.includes("psycopg")
  ) {
    return "postgres";
  }
  return "api-down";
}

export function StartupHints({ kind, detail, className = "" }: Props) {
  const copy = COPY[kind];

  return (
    <div
      className={`border border-line/80 bg-[#0c1210]/60 px-4 py-4 text-left ${className}`}
    >
      <p
        className={`text-sm font-medium ${
          kind === "empty-history" ? "text-foreground" : "text-warn"
        }`}
      >
        {copy.title}
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-muted">
        {copy.steps.map((step) => (
          <li key={step}>
            {kind === "empty-history" && step.startsWith("Open the tap") ? (
              <>
                Open the{" "}
                <Link href="/terminal" className="text-accent underline">
                  tap terminal
                </Link>
              </>
            ) : (
              step
            )}
          </li>
        ))}
      </ol>
      {copy.tip ? <p className="mt-3 text-xs text-muted">{copy.tip}</p> : null}
      {detail ? (
        <p className="mt-3 break-words font-mono text-xs text-muted/80">
          {truncate(detail, 280)}
        </p>
      ) : null}
    </div>
  );
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
