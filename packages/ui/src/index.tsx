"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export function joinClassNames(
  ...values: readonly (string | false | null | undefined)[]
): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  children,
  className,
  loading = false,
  variant = "primary",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly loading?: boolean;
  readonly variant?: ButtonVariant;
}): React.JSX.Element {
  return (
    <button
      className={joinClassNames("button", `button--${variant}`, className)}
      disabled={disabled === true || loading}
      {...props}
    >
      {loading && <Spinner label="Working" size="small" />}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className={joinClassNames("icon-button", className)}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={joinClassNames("input", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      className={joinClassNames("input", "textarea", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={joinClassNames("input", "select", className)}
      {...props}
    />
  );
}

export function Checkbox({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={joinClassNames("checkbox", className)}
      type="checkbox"
      {...props}
    />
  );
}

export function Field({
  children,
  hint,
  htmlFor,
  label,
  required,
}: {
  readonly children: ReactNode;
  readonly hint?: ReactNode;
  readonly htmlFor?: string;
  readonly label: ReactNode;
  readonly required?: boolean;
}): React.JSX.Element {
  const labelNode = (
    <label
      className="field__label"
      {...(htmlFor === undefined ? {} : { htmlFor })}
    >
      {label}
      {required === true && <span aria-hidden="true"> *</span>}
    </label>
  );
  if (htmlFor !== undefined)
    return (
      <div className="field">
        {labelNode}
        {children}
        {hint !== undefined && <span className="field__hint">{hint}</span>}
      </div>
    );
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required === true && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint !== undefined && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function FormMessage({
  children,
  tone = "error",
}: {
  readonly children: ReactNode;
  readonly tone?: "error" | "success" | "info";
}): React.JSX.Element {
  return (
    <p
      className={`form-message form-message--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLElement>): React.JSX.Element {
  return <section className={joinClassNames("card", className)} {...props} />;
}

export function StatCard({
  description,
  title,
  value,
}: {
  readonly description?: ReactNode;
  readonly title: ReactNode;
  readonly value: ReactNode;
}): React.JSX.Element {
  return (
    <Card className="stat-card">
      <span className="stat-card__title">{title}</span>
      <strong className="stat-card__value">{value}</strong>
      {description !== undefined && (
        <span className="stat-card__description">{description}</span>
      )}
    </Card>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "info" | "success" | "warning" | "danger";
}): React.JSX.Element {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Alert({
  children,
  title,
  tone = "info",
}: {
  readonly children: ReactNode;
  readonly title?: ReactNode;
  readonly tone?: "info" | "success" | "warning" | "danger";
}): React.JSX.Element {
  return (
    <div
      className={`alert alert--${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {title !== undefined && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function Progress({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.JSX.Element {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="progress">
      <div className="progress__label">
        <span>{label}</span>
        <span>{bounded}%</span>
      </div>
      <progress aria-label={label} max={100} value={bounded} />
    </div>
  );
}

export function Spinner({
  label = "Loading",
  size = "medium",
}: {
  readonly label?: string;
  readonly size?: "small" | "medium";
}): React.JSX.Element {
  return (
    <span
      aria-label={label}
      className={`spinner spinner--${size}`}
      role="status"
    />
  );
}

export function Skeleton({
  className,
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={joinClassNames("skeleton", className)}
    />
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: ReactNode;
  readonly title: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__mark" aria-hidden="true">
        ○
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Tabs({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className="tabs">
      {children}
    </nav>
  );
}

export function Breadcrumbs({
  items,
}: {
  readonly items: readonly { readonly href?: string; readonly label: string }[];
}): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href === undefined ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Overlay({
  children,
  label,
  onClose,
  variant,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose: () => void;
  readonly variant: "modal" | "drawer";
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || panel.current === null) return;
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => !item.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        aria-label={label}
        aria-modal="true"
        className={variant}
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export function Modal(
  props: Omit<Parameters<typeof Overlay>[0], "variant">,
): React.JSX.Element {
  return <Overlay {...props} variant="modal" />;
}

export function Drawer(
  props: Omit<Parameters<typeof Overlay>[0], "variant">,
): React.JSX.Element {
  return <Overlay {...props} variant="drawer" />;
}

export function Table({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <div className="table-scroll" tabIndex={0}>
      <table className={joinClassNames("table", className)} {...props} />
    </div>
  );
}

export function Pagination({
  children,
  label = "Pagination",
}: {
  readonly children: ReactNode;
  readonly label?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className="pagination">
      {children}
    </nav>
  );
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
}): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        {eyebrow !== undefined && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description !== undefined && <p>{description}</p>}
      </div>
      {actions !== undefined && (
        <div className="page-header__actions">{actions}</div>
      )}
    </header>
  );
}

export function SectionHeader({
  actions,
  description,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
}): React.JSX.Element {
  return (
    <header className="section-header">
      <div>
        <h2>{title}</h2>
        {description !== undefined && <p>{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Tooltip({
  children,
  content,
}: {
  readonly children: ReactNode;
  readonly content: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <span className="tooltip">
      <span aria-describedby={id}>{children}</span>
      <span className="tooltip__content" id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}

const acronyms: Readonly<Record<string, string>> = {
  BOQ: "BOQ",
  CPPP: "CPPP",
  GST: "GST",
  MSME: "MSME",
  OEM: "OEM",
  PAN: "PAN",
  UDYAM: "Udyam",
};
const explicitLabels: Readonly<Record<string, string>> = {
  "500_PLUS": "More than 500 employees",
  HUMAN_REVIEW_REQUIRED: "Human review required",
  NOT_BLACKLISTED: "Not blacklisted",
  OEM_AUTHORISATION: "OEM authorisation",
  PRIVATE_LIMITED: "Private limited company",
  TENDER_EXECUTIVE: "Tender executive",
};

export function humanizeEnum(value: string): string {
  const explicit = explicitLabels[value];
  if (explicit !== undefined) return explicit;
  const words = value.split("_").filter(Boolean);
  return words
    .map(
      (word, index) =>
        acronyms[word] ??
        (index === 0
          ? `${word.charAt(0)}${word.slice(1).toLowerCase()}`
          : word.toLowerCase()),
    )
    .join(" ");
}
