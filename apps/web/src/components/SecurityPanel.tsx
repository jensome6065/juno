"use client";

import { useEffect, useState, useTransition } from "react";
import { api, type SecurityStatus } from "@/lib/api";

type ProbeResult = { status: number; detail: string } | null;

export function SecurityPanel({ live }: { live: "connecting" | "live" | "offline" }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [unsignedProbe, setUnsignedProbe] = useState<ProbeResult>(null);
  const [badSigProbe, setBadSigProbe] = useState<ProbeResult>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    api.securityStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  function runProbes() {
    startTransition(async () => {
      const [unsigned, bad] = await Promise.all([
        api.probeUnsignedWebhook(),
        api.probeBadSignatureWebhook(),
      ]);
      setUnsignedProbe(unsigned);
      setBadSigProbe(bad);
      const next = await api.securityStatus().catch(() => null);
      if (next) setStatus(next);
    });
  }

  return (
    <section
      id="security"
      className="animate-rise border-t border-line pt-10 [animation-delay:200ms]"
    >
      <h2 className="font-[family-name:var(--font-display)] text-2xl">
        Security controls
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Authorization webhooks must present a valid Stripe signature. Decisions
        are idempotent by authorization id, and raw PANs are never stored.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Control
          ok={status?.signature_required ?? true}
          label="Signature required"
          detail="Unsigned Stripe webhooks are rejected"
        />
        <Control
          ok={status?.stripe_webhook_secret_configured ?? false}
          label="Webhook secret"
          detail={
            status?.stripe_webhook_secret_configured
              ? "STRIPE_WEBHOOK_SECRET loaded"
              : "Set whsec from stripe listen"
          }
        />
        <Control
          ok={status?.idempotent_authorizations ?? true}
          label="Idempotent auths"
          detail="Same authorization_id cannot double-route"
        />
        <Control
          ok={!(status?.stores_raw_pan ?? false)}
          label="No raw PAN storage"
          detail="Only demo last4 from card-rules"
        />
        <Control
          ok={live === "live"}
          label="Realtime stream"
          detail={live === "live" ? "SSE connected" : "Waiting for /events"}
        />
        <Control
          ok={status?.stripe_api_key_configured ?? false}
          label="Stripe API key"
          detail={
            status?.stripe_api_key_configured
              ? "Test key present"
              : "Optional for Issuing approve"
          }
        />
      </div>

      {status && !status.stripe_webhook_secret_configured ? (
        <div className="mt-6 border border-line/80 px-4 py-4 text-sm text-muted">
          <p className="font-medium text-warn">Webhook secret not loaded</p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-4">
            <li>
              <code className="text-foreground">
                stripe listen --events issuing_authorization.request
                --forward-to localhost:8000/webhooks/stripe
              </code>
            </li>
            <li>
              Put the printed <code className="text-foreground">whsec_…</code>{" "}
              in <code className="text-foreground">.env</code> as{" "}
              <code className="text-foreground">STRIPE_WEBHOOK_SECRET</code>
            </li>
            <li>Restart uvicorn, then refresh this page</li>
          </ol>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={runProbes}
          className="rounded-full border border-accent px-5 py-3 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-50"
        >
          {pending ? "Probing…" : "Probe webhook rejects"}
        </button>
        <p className="text-sm text-muted">
          Sends unsigned + bad-signature requests to{" "}
          <code className="text-foreground">/webhooks/stripe</code>
        </p>
      </div>

      {(unsignedProbe || badSigProbe) && (
        <ul className="mt-4 space-y-2 text-sm">
          {unsignedProbe ? (
            <li className={probeClass(unsignedProbe.status)}>
              Unsigned → HTTP {unsignedProbe.status}: {unsignedProbe.detail}
            </li>
          ) : null}
          {badSigProbe ? (
            <li className={probeClass(badSigProbe.status)}>
              Bad signature → HTTP {badSigProbe.status}: {badSigProbe.detail}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function Control({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="border border-line px-4 py-4">
      <p className={`text-xs tracking-wide uppercase ${ok ? "text-accent" : "text-warn"}`}>
        {ok ? "On" : "Off"}
      </p>
      <p className="mt-2 font-medium">{label}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function probeClass(status: number) {
  return status >= 400
    ? "text-accent"
    : "text-warn";
}
