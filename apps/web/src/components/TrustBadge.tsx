"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type SecurityStatus } from "@/lib/api";

type LiveState = "connecting" | "live" | "offline";

type Props = {
  live: LiveState;
};

export function TrustBadge({ live }: Props) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.securityStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const issues: string[] = [];
  if (live === "offline") {
    issues.push("Live updates are reconnecting");
  }
  if (status && !status.stripe_webhook_secret_configured) {
    issues.push("Webhook verification isn’t fully configured yet");
  }

  const protectedOk = issues.length === 0 && live !== "connecting";
  const label =
    live === "connecting"
      ? "Checking…"
      : protectedOk
        ? "Protected"
        : "Needs attention";

  const tone = protectedOk
    ? "border-accent/40 text-accent"
    : live === "connecting"
      ? "border-line text-muted"
      : "border-warn/40 text-warn";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full border px-2.5 py-0.5 text-xs tracking-wide transition hover:brightness-110 ${tone}`}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-2xl border border-line bg-panel px-4 py-3 text-left shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
          {protectedOk ? (
            <ul className="space-y-2 text-sm text-muted">
              <li>Every tap is verified before it routes</li>
              <li>The same charge can’t route twice</li>
              <li>Card numbers never leave the vault</li>
            </ul>
          ) : (
            <ul className="space-y-2 text-sm text-muted">
              {issues.map((issue) => (
                <li key={issue} className="text-warn">
                  {issue}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/lab"
            className="mt-3 inline-block text-xs text-accent transition hover:brightness-110"
            onClick={() => setOpen(false)}
          >
            Open Lab for proof checks →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
