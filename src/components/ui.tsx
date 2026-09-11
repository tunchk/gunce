import Link from "next/link";
import { ChildNav } from "@/components/child-nav";
import {
  GuardedLink,
  NavigationGuardProvider,
} from "@/components/navigation-guard";

type Props = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  wide?: boolean;
  /** Fixed child bottom navigation (Ana / Günlüğüm / Planım / Hedeflerim). */
  withChildNav?: boolean;
  /** Optional top-right action (e.g. Ayarlar). */
  headerAction?: React.ReactNode;
};

export function Shell({
  children,
  title,
  subtitle,
  wide,
  withChildNav,
  headerAction,
}: Props) {
  const body = (
    <>
      <main
        className={`mx-auto w-full px-4 py-8 sm:px-6 ${withChildNav ? "pb-36" : ""}`}
        style={{ maxWidth: wide ? 720 : 480 }}
      >
        <header className="mb-8">
          <div className="flex items-start justify-between gap-3">
            {withChildNav ? (
              <GuardedLink
                href="/cocuk/ana"
                className="inline-block text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display-loaded), var(--font-display)" }}
              >
                Günce
              </GuardedLink>
            ) : (
              <Link
                href="/"
                className="inline-block text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display-loaded), var(--font-display)" }}
              >
                Günce
              </Link>
            )}
            {headerAction ? (
              <div className="shrink-0 pt-1">{headerAction}</div>
            ) : null}
          </div>
          {title ? (
            <h1 className="mt-4 text-2xl font-semibold leading-tight sm:text-3xl">{title}</h1>
          ) : null}
          {subtitle ? (
            <p className="mt-2 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
              {subtitle}
            </p>
          ) : null}
        </header>
        {children}
      </main>
      {withChildNav ? <ChildNav /> : null}
    </>
  );

  if (!withChildNav) return body;
  return <NavigationGuardProvider>{body}</NavigationGuardProvider>;
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`p-5 sm:p-6 ${className}`}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
        backdropFilter: "blur(10px)",
      }}
    >
      {children}
    </section>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm" style={{ color: "var(--danger)" }} role="alert">
      {message}
    </p>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "var(--accent)",
      color: "white",
    },
    secondary: {
      background: "var(--accent-soft)",
      color: "var(--ink)",
    },
    danger: {
      background: "rgba(180, 35, 24, 0.1)",
      color: "var(--danger)",
    },
    ghost: {
      background: "transparent",
      color: "var(--muted)",
      border: "1px solid var(--line)",
    },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold transition disabled:opacity-50 ${className}`}
      style={styles[variant]}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  name,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
}) {
  const id = props.id || name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        id={id}
        name={name}
        className="min-h-12 w-full rounded-2xl border px-4"
        style={{ borderColor: error ? "var(--danger)" : "var(--line)", background: "white" }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <span id={error ? `${id}-error` : undefined}>
        <FieldError message={error} />
      </span>
    </label>
  );
}

export function SelectField({
  label,
  name,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
}) {
  const id = props.id || name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <select
        id={id}
        name={name}
        className="min-h-12 w-full rounded-2xl border px-4"
        style={{ borderColor: error ? "var(--danger)" : "var(--line)", background: "white" }}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {children}
      </select>
      <FieldError message={error} />
    </label>
  );
}

export function SoonBadge() {
  return (
    <span
      className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: "rgba(180, 83, 9, 0.12)", color: "var(--warn)" }}
    >
      Yakında
    </span>
  );
}

/** Compact child header link to settings (reminders, sign-out). */
export function ChildSettingsLink() {
  return (
    <GuardedLink
      href="/cocuk/ayarlar"
      className="inline-flex min-h-11 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
      style={{ border: "1px solid var(--line)", color: "var(--muted)" }}
    >
      Ayarlar
    </GuardedLink>
  );
}
