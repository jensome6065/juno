const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type Card = {
  id: string;
  name: string;
  issuer: string;
  last4: string;
  is_default: boolean;
  highlight: string;
  category_spend: number;
  intro_apr_ends_on: string | null;
};

export type Merchant = {
  id: string;
  name: string;
  mcc: string;
  category: string;
  typical_amount: number;
};

export type InferResponse = {
  category: string;
  confidence: number;
  source: string;
  override_id?: string | null;
  mcc_category?: string | null;
  mcc: string;
  merchant_name: string;
};

export type Transaction = {
  id: number;
  merchant_name: string;
  mcc: string;
  category: string;
  category_source?: string | null;
  category_confidence?: number | null;
  amount: number;
  selected_card_id: string;
  selected_card_name: string;
  default_card_name: string;
  reward_value: number;
  default_reward_value: number;
  extra_value: number;
  reason: string;
  cap_key?: string | null;
  cap_credited_cents?: number | null;
  cap_period_id?: string | null;
  cap_remaining_cents?: number | null;
  created_at: string;
};

export type RouteScore = {
  card_id: string;
  card_name: string;
  value: number;
  rate_used: number;
  reason: string;
  rank?: number | null;
  eligible?: boolean;
  constraint?: string | null;
  cap_split?: boolean;
  bonus_key?: string | null;
};

export type DecisionIntel = {
  category: string;
  category_source: string;
  category_confidence?: number | null;
  mcc_category?: string | null;
  override_id?: string | null;
  winner_cap_split?: boolean;
};

export type SimulateResponse = {
  transaction: Transaction;
  scores: RouteScore[];
  intel?: DecisionIntel | null;
  wallet_updated?: boolean;
  latency_ms?: number;
  signature_verified?: boolean;
  authorization_id?: string | null;
  idempotent_replay?: boolean;
};

export type SecurityStatus = {
  stripe_webhook_secret_configured: boolean;
  stripe_api_key_configured: boolean;
  signature_required: boolean;
  stores_raw_pan: boolean;
  idempotent_authorizations: boolean;
  realtime_decision_stream: boolean;
  webhook_path: string;
};

export type CapBucket = {
  spent_cents: number;
  limit_cents: number;
  remaining_cents: number;
  spent: number;
  limit: number;
  remaining: number;
  period: string;
  period_id: string;
  period_start: string;
  period_end: string;
  progress: number;
};

export type CapStatus = {
  as_of: string;
  caps: Record<string, Record<string, CapBucket>>;
};

export type DemoScriptStep = {
  beat: number;
  name: string;
  merchant_id: string;
  authorization_id: string;
  expected_card_id: string;
  transaction: Transaction;
  ok: boolean;
  note: string;
};

export type DemoScriptResponse = {
  ok: boolean;
  reset: boolean;
  steps: DemoScriptStep[];
  caps: CapStatus;
  wallet_updated: boolean;
};

export type WalletStatus = {
  configured: boolean;
  serial_number: string | null;
  share_url: string | null;
  google_save_url: string | null;
};

export type WalletPass = {
  serial_number: string;
  share_url: string | null;
  google_save_url: string | null;
  apple_pass: string | null;
};

export type DecisionEvent = {
  type: "decision.created" | "demo.reset" | "connected" | string;
  transaction?: Transaction;
  scores?: SimulateResponse["scores"];
  latency_ms?: number;
};

export const api = {
  baseUrl: API_URL,
  cards: () => request<Card[]>("/cards"),
  merchants: () => request<Merchant[]>("/merchants"),
  transactions: () => request<Transaction[]>("/transactions"),
  simulate: (
    merchant_id: string,
    amount?: number,
    authorization_id?: string,
    carry_months?: number,
  ) =>
    request<SimulateResponse>("/simulate", {
      method: "POST",
      body: JSON.stringify({
        merchant_id,
        amount,
        authorization_id,
        carry_months: carry_months ?? 0,
      }),
    }),
  simulateFreeText: (body: {
    merchant_name: string;
    mcc: string;
    amount: number;
    authorization_id?: string;
    carry_months?: number;
  }) =>
    request<SimulateResponse>("/simulate", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        carry_months: body.carry_months ?? 0,
      }),
    }),
  infer: (merchant_name: string, mcc: string) =>
    request<InferResponse>("/infer", {
      method: "POST",
      body: JSON.stringify({ merchant_name, mcc }),
    }),
  walletStatus: () => request<WalletStatus>("/wallet/status"),
  createWalletPass: () =>
    request<WalletPass>("/wallet/pass", {
      method: "POST",
    }),
  securityStatus: () => request<SecurityStatus>("/security/status"),
  resetDemo: () =>
    request<{ ok: boolean; wallet_updated: boolean }>("/demo/reset", {
      method: "POST",
    }),
  caps: () => request<CapStatus>("/caps"),
  runDemoScript: (reset = true, run_id?: string) =>
    request<DemoScriptResponse>("/demo/script", {
      method: "POST",
      body: JSON.stringify({ reset, run_id }),
    }),
  eventsUrl: () => `${API_URL}/events`,
  async probeUnsignedWebhook(): Promise<{ status: number; detail: string }> {
    const res = await fetch(`${API_URL}/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      // non-json body
    }
    return { status: res.status, detail };
  },
  async probeBadSignatureWebhook(): Promise<{ status: number; detail: string }> {
    const res = await fetch(`${API_URL}/webhooks/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": "t=1,v1=deadbeef",
      },
      body: "{}",
      cache: "no-store",
    });
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      // non-json body
    }
    return { status: res.status, detail };
  },
};
