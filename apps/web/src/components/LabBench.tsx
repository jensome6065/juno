"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { SiteNav } from "@/components/SiteNav";
import { api, type AuditEvent, type SecurityStatus } from "@/lib/api";

type ProbeResult = { status: number; detail: string };

export function LabBench() {
  const [live, setLive] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [seedPending, startSeed] = useTransition();
  const [beatPending, startBeat] = useTransition();
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [unsignedProbe, setUnsignedProbe] = useState<ProbeResult | null>(null);
  const [badSigProbe, setBadSigProbe] = useState<ProbeResult | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  function refreshAudit() {
    api.audit(24).then(setAudit).catch(() => setAudit([]));
  }

  useEffect(() => {
    api.securityStatus().then(setStatus).catch(() => setStatus(null));
    refreshAudit();
  }, []);

  useEffect(() => {
    const source = new EventSource(api.eventsUrl());
    source.onopen = () => setLive("live");
    source.onerror = () => setLive("offline");
    source.onmessage = (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data) as { type?: string };
        if (event.type === "connected" || event.type === "decision.created") {
          setLive("live");
        }
      } catch {
        // ignore
      }
    };
    return () => source.close();
  }, []);

  const checks = [
    {
      ok: (status?.signature_required ?? true) && live !== "offline",
      label: "Every tap is verified",
      detail:
        status?.stripe_webhook_secret_configured
          ? "Webhook signature required"
          : "Set STRIPE_WEBHOOK_SECRET for full lock",
    },
    {
      ok: status?.idempotent_authorizations ?? true,
      label: "Same charge can’t route twice",
      detail: "Replay the same auth on Terminal to prove it",
    },
    {
      ok: !(status?.stores_raw_pan ?? false),
      label: "Card numbers stay vaulted",
      detail: "Only demo last4 - no raw PAN storage",
    },
    {
      ok: status?.demo_api_key_configured ?? false,
      label: "Demo mutate routes locked",
      detail: "X-Demo-Key required for /simulate and /demo",
    },
    {
      ok: status?.audit_log_enabled ?? true,
      label: "Append-only audit trail",
      detail: "Rejects and routes survive pitch resets",
    },
  ];

  const allOk = checks.every((c) => c.ok);
  const probesOk =
    unsignedProbe != null &&
    badSigProbe != null &&
    unsignedProbe.status >= 400 &&
    badSigProbe.status >= 400;

  function seedPitch() {
    if (
      !window.confirm(
        "Clear spam taps and load a varied pitch history (coffee, gas, grocery, flight, …)?",
      )
    ) {
      return;
    }
    setSeedError(null);
    setSeedMessage(null);
    startSeed(async () => {
      try {
        await api.runDemoScript(true);
        setSeedMessage("Pitch history seeded.");
        refreshAudit();
      } catch (e) {
        setSeedError(e instanceof Error ? e.message : "Reset failed");
      }
    });
  }

  function runSecurityBeat() {
    startBeat(async () => {
      const [unsigned, bad, next] = await Promise.all([
        api.probeUnsignedWebhook(),
        api.probeBadSignatureWebhook(),
        api.securityStatus().catch(() => null),
      ]);
      setUnsignedProbe(unsigned);
      setBadSigProbe(bad);
      if (next) setStatus(next);
      refreshAudit();
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteNav active="lab" live={live} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
        <header className="animate-rise space-y-3">
          <p className="text-sm tracking-[0.2em] text-muted uppercase">Lab</p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight md:text-5xl">
            Security beat
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted">
            Seed the pitch, then prove that bad webhooks get rejected and
            charges can’t double-route.
          </p>
        </header>

        <section
          className={`animate-rise rounded-2xl px-5 py-5 ring-1 [animation-delay:60ms] ${
            allOk
              ? "bg-accent/5 ring-accent/25"
              : "bg-panel/60 ring-white/5"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs tracking-[0.2em] text-muted uppercase">
              Trust checks
            </p>
            <p className={`text-sm ${allOk ? "text-accent" : "text-warn"}`}>
              {allOk ? "Ready to demo" : "Needs attention"}
            </p>
          </div>
          <ul className="mt-4 space-y-3">
            {checks.map((check) => (
              <li key={check.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 text-xs tracking-wide uppercase ${
                    check.ok ? "text-accent" : "text-warn"
                  }`}
                >
                  {check.ok ? "Pass" : "Fail"}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{check.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="animate-rise space-y-4 [animation-delay:100ms]">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={beatPending}
              onClick={runSecurityBeat}
              className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
            >
              {beatPending ? "Proving…" : "Run security beat"}
            </button>
            <p className="text-sm text-muted">
              Sends unsigned + bad-signature webhooks. Expect rejects in the audit trail.
            </p>
          </div>

          {(unsignedProbe || badSigProbe) && (
            <div
              className={`rounded-2xl px-4 py-4 ring-1 ${
                probesOk
                  ? "bg-accent/5 ring-accent/25"
                  : "bg-warn/5 ring-warn/30"
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  probesOk ? "text-accent" : "text-warn"
                }`}
              >
                {probesOk
                  ? "Rejects confirmed - unsigned and bad signatures blocked"
                  : "Unexpected accept - check webhook secret / API"}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-muted">
                {unsignedProbe ? (
                  <li>
                    Unsigned → HTTP {unsignedProbe.status}
                    {unsignedProbe.detail ? `: ${unsignedProbe.detail}` : ""}
                  </li>
                ) : null}
                {badSigProbe ? (
                  <li>
                    Bad signature → HTTP {badSigProbe.status}
                    {badSigProbe.detail ? `: ${badSigProbe.detail}` : ""}
                  </li>
                ) : null}
              </ul>
              <p className="mt-3 text-sm text-muted">
                Next: open{" "}
                <Link href="/terminal" className="text-accent hover:brightness-110">
                  Terminal
                </Link>
                , tap once, then replay to prove no double-route.
              </p>
            </div>
          )}
        </section>

        <section className="animate-rise space-y-3 [animation-delay:120ms]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-xl">
              Audit trail
            </h2>
            <button
              type="button"
              onClick={refreshAudit}
              className="text-sm text-accent transition hover:brightness-110"
            >
              Refresh
            </button>
          </div>
          <p className="text-sm text-muted">
            Append-only. Pitch resets wipe spend, not this log.
          </p>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">No events yet - run the security beat.</p>
          ) : (
            <ul className="space-y-2">
              {audit.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 border-b border-line/50 pb-2 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span
                        className={
                          row.outcome === "rejected" || row.outcome === "declined"
                            ? "text-warn"
                            : row.outcome === "idempotent"
                              ? "text-muted"
                              : "text-accent"
                        }
                      >
                        {row.outcome.toUpperCase()}
                      </span>
                      <span className="ml-2 text-foreground">{row.action}</span>
                    </p>
                    <p className="mt-0.5 truncate text-muted">
                      {row.detail ||
                        [row.merchant_name, row.selected_card_name]
                          .filter(Boolean)
                          .join(" → ") ||
                        "—"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {row.http_status ? `HTTP ${row.http_status}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="animate-rise border-t border-line pt-8 [animation-delay:140ms]">
          <h2 className="font-[family-name:var(--font-display)] text-xl">
            Pitch seed
          </h2>
          <p className="mt-2 text-sm text-muted">
            Wipe spam taps and load a varied coffee → gas → grocery history.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={seedPending}
              onClick={seedPitch}
              className="rounded-full px-5 py-3 text-sm text-accent ring-1 ring-accent/40 transition hover:bg-accent/10 disabled:opacity-50"
            >
              {seedPending ? "Seeding…" : "Reset & seed pitch"}
            </button>
          </div>
          {seedMessage ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-accent">{seedMessage}</span>
              <Link href="/" className="text-muted transition hover:text-accent">
                Dashboard →
              </Link>
              <Link
                href="/terminal"
                className="text-muted transition hover:text-accent"
              >
                Terminal →
              </Link>
            </div>
          ) : null}
          {seedError ? (
            <p className="mt-3 text-sm text-warn">{seedError}</p>
          ) : null}
        </section>

        <section className="animate-rise border-t border-line pt-6 [animation-delay:160ms]">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-4 text-left"
            aria-expanded={detailsOpen}
          >
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-lg">
                Technical details
              </h2>
              <p className="mt-1 text-sm text-muted">
                Env flags, SSE, and Issuing key status.
              </p>
            </div>
            <span className="shrink-0 text-sm text-accent">
              {detailsOpen ? "Hide" : "Show"}
            </span>
          </button>

          {detailsOpen ? (
            <div className="mt-5 space-y-4">
              <ul className="space-y-2 text-sm text-muted">
                <Detail
                  ok={status?.stripe_webhook_secret_configured === true}
                  label="Webhook secret"
                  detail={
                    !status
                      ? "API unreachable - restart uvicorn"
                      : status.stripe_webhook_secret_configured
                        ? "STRIPE_WEBHOOK_SECRET loaded"
                        : "Set whsec from stripe listen"
                  }
                />
                <Detail
                  ok={live === "live"}
                  label="Live stream"
                  detail={
                    live === "live"
                      ? "SSE connected"
                      : live === "offline"
                        ? "API offline - restart uvicorn"
                        : "Waiting for /events"
                  }
                />
                <Detail
                  ok={status?.stripe_api_key_configured === true}
                  label="Stripe API key"
                  detail={
                    !status
                      ? "API unreachable - restart uvicorn"
                      : status.stripe_api_key_configured
                        ? "Test key present"
                        : "Optional for Issuing approve"
                  }
                />
                <Detail
                  ok={status?.idempotent_authorizations === true}
                  label="Idempotent auths"
                  detail={
                    !status
                      ? "API unreachable - restart uvicorn"
                      : "Same authorization_id cannot double-route"
                  }
                />
                <Detail
                  ok={status?.demo_api_key_configured === true}
                  label="Demo API key"
                  detail={
                    !status
                      ? "API unreachable - restart uvicorn"
                      : status.demo_api_key_configured
                        ? "X-Demo-Key required on mutate routes"
                        : "Set DEMO_API_KEY in .env"
                  }
                />
                <Detail
                  ok={status?.rate_limit_enabled === true}
                  label="Rate limit"
                  detail={
                    !status
                      ? "API unreachable - restart uvicorn"
                      : "Per-IP limit on simulate / demo / webhooks"
                  }
                />
              </ul>

              {status && !status.stripe_webhook_secret_configured ? (
                <div className="rounded-xl bg-white/[0.03] px-4 py-4 text-sm text-muted">
                  <p className="font-medium text-warn">Webhook secret missing</p>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-4">
                    <li>
                      <code className="text-foreground">
                        stripe listen --events issuing_authorization.request
                        --forward-to localhost:8000/webhooks/stripe
                      </code>
                    </li>
                    <li>
                      Put <code className="text-foreground">whsec_…</code> in{" "}
                      <code className="text-foreground">.env</code> as{" "}
                      <code className="text-foreground">
                        STRIPE_WEBHOOK_SECRET
                      </code>
                    </li>
                    <li>Restart uvicorn, then refresh</li>
                  </ol>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Detail({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-2 last:border-0">
      <span>
        <span className={ok ? "text-accent" : "text-warn"}>
          {ok ? "On" : "Off"}
        </span>
        <span className="ml-2 text-foreground">{label}</span>
      </span>
      <span className="text-right text-muted">{detail}</span>
    </li>
  );
}
