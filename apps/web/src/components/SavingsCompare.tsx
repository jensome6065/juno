import { money } from "@/lib/format";

type Props = {
  defaultCardName: string;
  selectedCardName: string;
  defaultRewardValue: number;
  rewardValue: number;
  extraValue: number;
  /** Compact for history rows; default is the full terminal/hero layout. */
  compact?: boolean;
};

export function SavingsCompare({
  defaultCardName,
  selectedCardName,
  defaultRewardValue,
  rewardValue,
  extraValue,
  compact = false,
}: Props) {
  if (compact) {
    return (
      <p className="mt-1 text-sm text-muted">
        {money(defaultRewardValue)} on {defaultCardName} →{" "}
        <span className="text-foreground">{money(rewardValue)}</span> on{" "}
        {selectedCardName}
        {extraValue > 0 ? (
          <span className="text-accent"> · +{money(extraValue)}</span>
        ) : null}
      </p>
    );
  }

  return (
    <div className="border-t border-line/80 pt-4">
      <p className="text-xs tracking-[0.2em] text-muted uppercase">
        Without Juno vs with Juno
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Default card</p>
          <p className="mt-1 text-sm">{defaultCardName}</p>
          <p className="mt-1 text-muted">{money(defaultRewardValue)} rewards</p>
        </div>
        <div>
          <p className="text-xs text-accent">Juno routed</p>
          <p className="mt-1 text-sm">{selectedCardName}</p>
          <p className="mt-1 text-accent">{money(rewardValue)} rewards</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-accent">
        {extraValue > 0
          ? `You earned ${money(extraValue)} more on this purchase`
          : extraValue < 0
            ? `Routed ${money(Math.abs(extraValue))} less than default (rule/cap)`
            : "Same rewards as your default card"}
      </p>
    </div>
  );
}
