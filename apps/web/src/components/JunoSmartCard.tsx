type JunoSmartCardProps = {
  className?: string;
};

export function JunoSmartCard({ className = "" }: JunoSmartCardProps) {
  return (
    <div
      className={`animate-rise relative w-full max-w-md justify-self-end [animation-delay:100ms] ${className}`}
      aria-label="Juno smart card"
    >
      {/* Clip the PNG's jagged alpha into a smooth CSS radius */}
      <div className="overflow-hidden rounded-[1.15rem] shadow-[0_28px_50px_rgba(16,40,28,0.35)]">
        <img
          src="/juno-smart-card.png"
          alt="Juno smart card - routes to your best card"
          width={981}
          height={516}
          className="block h-auto w-full scale-[1.015]"
          draggable={false}
        />
      </div>
      <span className="sr-only">
        Juno Smart Card. Routes to your best card.
      </span>
    </div>
  );
}
