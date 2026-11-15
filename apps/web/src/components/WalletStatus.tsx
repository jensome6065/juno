"use client";

import { useState } from "react";
import type { WalletStatus as WalletStatusType } from "@/lib/api";

type Props = {
  wallet: WalletStatusType | null;
  pending: boolean;
  error: string | null;
  onAdd: () => void;
};

export function WalletStatus({ wallet, pending, error, onAdd }: Props) {
  const [copied, setCopied] = useState<"apple" | "google" | null>(null);

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

  const stateClass = !configured
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

  return (
    <div className="space-y-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          Wallet passes
        </p>
        <p className={`text-xs tracking-wide uppercase ${stateClass}`}>
          {stateLabel}
        </p>
      </div>

      {!configured ? (
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
        <div className="space-y-2 text-sm text-muted">
          {wallet?.serial_number ? (
            <p>
              Pass serial{" "}
              <code className="text-foreground">{wallet.serial_number}</code>
            </p>
          ) : null}
          <p>
            Open Apple or Google on your phone. After each terminal tap, the
            Apple pass updates with the winning card.
          </p>
        </div>
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
            {pending ? "Creating pass…" : "Create Wallet pass"}
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
