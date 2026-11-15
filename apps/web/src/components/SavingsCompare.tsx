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
  const baselineLabel =
    defaultCardName.toLowerCase().includes("baseline") ||
    defaultCardName.includes("1%")
      ? defaultCardName
      : "1% baseline";

  if (compact) {
    return (
      <p className="mt-1 text-sm text-muted">
        {money(defaultRewardValue)} at {baselineLabel} →{" "}
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
        Vs 1% baseline
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Without Juno</p>
          <p className="mt-1 text-sm">{baselineLabel}</p>
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
          ? `You earned ${money(extraValue)} more than a flat 1% card`
          : extraValue < 0
            ? `Routed ${money(Math.abs(extraValue))} less than 1% (rule/cap)`
            : "Same rewards as a flat 1% card"}
      </p>
    </div>
  );
}
