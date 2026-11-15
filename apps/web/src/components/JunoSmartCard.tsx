type JunoSmartCardProps = {
  className?: string;
};

export function JunoSmartCard({ className = "" }: JunoSmartCardProps) {
  return (
    <div
      className={`animate-rise relative w-full max-w-md justify-self-end [animation-delay:100ms] ${className}`}
      aria-label="Juno smart card"
    >
      {/* Exact product art — all wording is in the image, so nothing clips */}
      <img
        src="/juno-smart-card.png"
        alt="Juno smart card — routes to your best card"
        width={981}
        height={516}
        className="block h-auto w-full drop-shadow-[0_28px_50px_rgba(16,40,28,0.35)]"
        draggable={false}
      />
      <span className="sr-only">
        Juno Smart Card. Routes to your best card.
      </span>
    </div>
  );
}
