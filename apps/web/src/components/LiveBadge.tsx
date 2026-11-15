type LiveState = "connecting" | "live" | "offline";

export function LiveBadge({ state }: { state: LiveState }) {
  const label =
    state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  const color =
    state === "live"
      ? "border-accent/40 text-accent"
      : state === "connecting"
        ? "border-line text-muted"
        : "border-warn/40 text-warn";

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs tracking-wide ${color}`}
    >
      {label}
    </span>
  );
}
