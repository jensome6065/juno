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

export type Transaction = {
  id: number;
  merchant_name: string;
  mcc: string;
  category: string;
  amount: number;
  selected_card_id: string;
  selected_card_name: string;
  default_card_name: string;
  reward_value: number;
  default_reward_value: number;
  extra_value: number;
  reason: string;
  created_at: string;
};

export type SimulateResponse = {
  transaction: Transaction;
  scores: Array<{
    card_id: string;
    card_name: string;
    value: number;
    rate_used: number;
    reason: string;
  }>;
  wallet_updated?: boolean;
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

export const api = {
  cards: () => request<Card[]>("/cards"),
  merchants: () => request<Merchant[]>("/merchants"),
  transactions: () => request<Transaction[]>("/transactions"),
  simulate: (merchant_id: string, amount?: number) =>
    request<SimulateResponse>("/simulate", {
      method: "POST",
      body: JSON.stringify({ merchant_id, amount }),
    }),
  walletStatus: () => request<WalletStatus>("/wallet/status"),
  createWalletPass: () =>
    request<WalletPass>("/wallet/pass", {
      method: "POST",
    }),
};
