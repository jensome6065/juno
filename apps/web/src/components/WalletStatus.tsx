"use client";

import { useState } from "react";
import type { WalletStatus as WalletStatusType } from "@/lib/api";

type Props = {
  wallet: WalletStatusType | null;
  pending: boolean;
  error: string | null;
  onAdd: () => void;
  /** Single-line strip for the dashboard hero. */
  compact?: boolean;
};

export function WalletStatus({
  wallet,
  pending,
  error,
  onAdd,
  compact = false,
}: Props) {
  const [copied, setCopied] = useState<"apple" | "google" | null>(null);
  const [expanded, setExpanded] = useState(false);

  const configured = wallet?.configured === true;
  const appleUrl = wallet?.share_url ?? null;
  const googleUrl = wallet?.google_save_url ?? null;
  const inWallet = Boolean(wallet?.serial_number || appleUrl || googleUrl);

  const stateLabel = !wallet
    ? "Checking…"
    : !configured
      ? "Not configured"
      : inWallet
        ? "Pass ready"
        : "API key set";

  const stateClass = !wallet
    ? "text-muted"
    : !configured
      ? "text-warn"
      : inWallet
        ? "text-accent"
        : "text-muted";

  async function copyLink(kind: "apple" | "google", url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className={stateClass}>{stateLabel}</span>
          {appleUrl ? (
            <a
              href={appleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent transition hover:brightness-110"
            >
              Apple
            </a>
          ) : null}
          {googleUrl ? (
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent transition hover:brightness-110"
            >
              Google
            </a>
          ) : null}
          {!appleUrl && !googleUrl ? (
            <button
              type="button"
              disabled={pending || !configured}
              onClick={onAdd}
              className="text-accent transition hover:brightness-110 disabled:opacity-50"
            >
              {pending ? "Creating…" : "Add to Wallet"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="text-muted transition hover:text-foreground"
            >
              {expanded ? "Less" : "Details"}
            </button>
          )}
        </div>
        {expanded ? (
          <div className="space-y-2 text-sm text-muted">
            {wallet?.serial_number ? (
              <p>
                Serial{" "}
                <code className="text-foreground">{wallet.serial_number}</code>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {appleUrl ? (
                <button
                  type="button"
                  onClick={() => copyLink("apple", appleUrl)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-foreground"
                >
                  {copied === "apple" ? "Copied" : "Copy Apple link"}
                </button>
              ) : null}
              {googleUrl ? (
                <button
                  type="button"
                  onClick={() => copyLink("google", googleUrl)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-foreground"
                >
                  {copied === "google" ? "Copied" : "Copy Google link"}
                </button>
              ) : null}
              {inWallet && configured ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={onAdd}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-foreground disabled:opacity-50"
                >
                  Sync pass
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {!wallet ? null : !configured ? (
          <p className="text-xs text-warn">
            Set <code className="text-foreground">WALLETWALLET_API_KEY</code> in
            .env
          </p>
        ) : null}
        {error ? <p className="text-xs text-warn">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          Wallet passes
        </p>
        <p className={`text-xs tracking-wide uppercase ${stateClass}`}>
          {stateLabel}
        </p>
      </div>

      {!wallet ? (
        <p className="text-sm text-muted">Checking WalletWallet…</p>
      ) : !configured ? (
        <p className="text-sm text-warn">
          Set <code className="text-foreground">WALLETWALLET_API_KEY</code> in{" "}
          <code className="text-foreground">.env</code> from{" "}
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
      ) : inWallet ? (
        <p className="text-sm text-muted">
          After each terminal tap, the Apple pass updates with the winning card.
          {wallet?.serial_number ? (
            <>
              {" "}
              Serial{" "}
              <code className="text-foreground">{wallet.serial_number}</code>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-muted">
          Create a WalletWallet pass, then open the share link on your phone.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {appleUrl ? (
          <>
            <a
              href={appleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent/10"
            >
              Apple Wallet
            </a>
            <button
              type="button"
              onClick={() => copyLink("apple", appleUrl)}
              className="rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-foreground"
            >
              {copied === "apple" ? "Copied" : "Copy Apple link"}
            </button>
          </>
        ) : null}
        {googleUrl ? (
          <>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent/10"
            >
              Google Wallet
            </a>
            <button
              type="button"
              onClick={() => copyLink("google", googleUrl)}
              className="rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-foreground"
            >
              {copied === "google" ? "Copied" : "Copy Google link"}
            </button>
          </>
        ) : null}
        {!appleUrl && !googleUrl ? (
          <button
            type="button"
            disabled={pending || !configured}
            onClick={onAdd}
            className="rounded-full border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-50"
          >
            {pending ? "Creating pass…" : "Add to Apple Wallet"}
          </button>
        ) : null}
        {inWallet && configured ? (
          <button
            type="button"
            disabled={pending}
            onClick={onAdd}
            className="rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-foreground disabled:opacity-50"
          >
            Sync / recreate pass
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-warn">{error}</p> : null}
    </div>
  );
}
