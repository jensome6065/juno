import Link from "next/link";

export function SiteNav({ active }: { active: "dashboard" | "terminal" }) {
  return (
    <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6">
      <Link
        href="/"
        className="font-[family-name:var(--font-display)] text-sm tracking-[0.35em] text-accent uppercase"
      >
        Juno
      </Link>
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/"
          className={`rounded-full px-4 py-2 transition ${
            active === "dashboard"
              ? "bg-accent text-accent-ink"
              : "text-muted hover:text-foreground"
          }`}
        >
          Dashboard
        </Link>
        <Link
          href="/terminal"
          className={`rounded-full px-4 py-2 transition ${
            active === "terminal"
              ? "bg-accent text-accent-ink"
              : "text-muted hover:text-foreground"
          }`}
        >
          Terminal
        </Link>
      </div>
    </nav>
  );
}
