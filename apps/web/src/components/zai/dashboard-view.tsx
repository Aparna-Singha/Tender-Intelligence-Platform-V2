"use client";

import { useRouter } from "next/navigation";
import {
  describeTender,
  formatDeadline,
  formatDeadlineCountdown,
  getDeadlineDays,
  type TenderSummary,
} from "../tender-presentation";

import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

import { motion } from "framer-motion";
import {
  Plus,
  FolderKanban,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  ArrowRight,
  ArrowUpRight,
  Clock,
  FileStack,
  FileWarning,
  CircleDashed,
} from "lucide-react";
import { cn } from "./utils";
import { EASE, staggerContainer, fadeUpItem } from "./motion";

export function DashboardView({
  tenders,
  userName,
  organisationName,
  organisationId,
  recommendations,
  onCreate,
  filter,
  onFilter,
  companyProgress,
}: {
  readonly tenders: readonly TenderSummary[];
  readonly userName: string;
  readonly organisationName: string;
  readonly organisationId: string | null;
  readonly recommendations: readonly {
    id: string;
    action: string;
    priority: string;
  }[];
  readonly onCreate: () => void;
  readonly filter: string;
  readonly onFilter: (
    filter: "ALL" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED",
  ) => void;
  readonly companyProgress: number | null;
}): React.JSX.Element {
  const router = useRouter();
  const openTender = (id: string): void => {
    if (organisationId)
      router.push(`/tenders/${organisationId}/${id}?stage=overview`);
  };
  const setPage = (page: string): void => {
    if (!organisationId) {
      onCreate();
      return;
    }
    router.push(
      page === "company-docs"
        ? `/documents/${organisationId}`
        : `/tenders/${organisationId}`,
    );
  };
  const activeTenders = tenders.filter(
    (t) => !describeTender(t).isCompleted,
  ).length;
  const attentionTenders = tenders.filter(
    (t) => describeTender(t).needsAttention,
  );
  const inProgress = tenders.filter((t) => describeTender(t).isInProgress);
  const inReview = tenders.filter(
    (t) => t.workflowState?.code === "REVIEW_READY",
  ).length;
  const upcomingDeadlines = tenders
    .filter((t) => {
      const days = getDeadlineDays(t.submissionDeadline);
      return days !== null && days >= 0 && !describeTender(t).isCompleted;
    })
    .sort((a, b) =>
      (a.submissionDeadline ?? "").localeCompare(b.submissionDeadline ?? ""),
    );
  const visible = tenders.filter((t) =>
    filter === "ACTIVE"
      ? !describeTender(t).isCompleted
      : filter === "IN_PROGRESS"
        ? describeTender(t).isInProgress
        : filter === "COMPLETED"
          ? describeTender(t).isCompleted
          : true,
  );
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="zai-design space-y-10"
    >
      {/* Hero header — industrial with orange highlight word */}
      <motion.div variants={fadeUpItem} className="relative overflow-hidden">
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FED7AA] bg-[var(--brand-orange-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-orange-deep)] mb-4 font-mono uppercase tracking-wider">
              <span className="status-dot bg-[var(--brand-orange)] animate-pulse-soft" />
              {organisationName}
            </div>
            <h1 className="text-4xl lg:text-5xl font-extrabold text-[#111827] tracking-tight leading-[1.05]">
              Welcome back,{" "}
              <span className="text-gradient-orange">
                {userName.split(" ")[0]}
              </span>
              .
            </h1>
            <p className="mt-4 text-[#6B7280] text-base lg:text-lg max-w-2xl leading-relaxed">
              Track upcoming deadlines, review outstanding requirements and{" "}
              <span className="text-[var(--brand-orange)] font-semibold">
                continue your tender preparation
              </span>
              .
            </p>
          </div>
          <Button
            onClick={() => setPage("tenders")}
            className="bg-[var(--brand-orange)] hover:bg-[#E64A19] text-white h-12 px-6 text-sm font-bold uppercase tracking-wider shadow-glow-orange rounded-xl group"
          >
            <Plus className="mr-2 h-4 w-4 transition-transform group-hover:rotate-90 duration-300" />
            Analyse new tender
          </Button>
        </div>
      </motion.div>

      {/* Summary cards */}
      <motion.div
        variants={fadeUpItem}
        role="group"
        aria-label="Workspace summary"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SummaryCard
          icon={FolderKanban}
          label="Active tenders"
          value={activeTenders}
          tone="orange"
          hint={`${inReview} awaiting review`}
          index={0}
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Needs attention"
          value={attentionTenders.length + recommendations.length}
          tone="danger"
          hint="Human review required"
          index={1}
        />
        <SummaryCard
          icon={Clock}
          label="Upcoming deadlines"
          value={upcomingDeadlines.length}
          tone="warning"
          hint={`Next: ${fmtDate(upcomingDeadlines[0]?.submissionDeadline)}`}
          index={2}
        />
        <SummaryCard
          icon={FileStack}
          label="In progress"
          value={inProgress.length}
          tone="cyan"
          hint="Backend workflow activity"
          index={3}
        />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Your Tenders — redesigned as spacious cards */}
        <motion.div
          variants={fadeUpItem}
          className="min-w-0 lg:col-span-2 space-y-6"
        >
          <section>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="label-mono mb-1">{"// Workspace"}</div>
                <h2 className="text-xl font-bold text-[#111827]">
                  Your tenders
                </h2>
                <p className="text-sm text-[#6B7280] mt-0.5">
                  Continue working on active projects
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage("tenders")}
                className="text-[var(--brand-orange)] hover:bg-[var(--brand-orange-soft)] rounded-lg font-semibold"
              >
                View all
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>

            <div
              className="flex flex-wrap gap-2 mb-4"
              role="group"
              aria-label="Tender filters"
            >
              {(["ALL", "ACTIVE", "IN_PROGRESS", "COMPLETED"] as const).map(
                (value) => (
                  <Button
                    key={value}
                    variant={filter === value ? "default" : "outline"}
                    aria-pressed={filter === value}
                    onClick={() => onFilter(value)}
                  >
                    {value === "ALL"
                      ? `All ${tenders.length}`
                      : value === "ACTIVE"
                        ? `Active ${activeTenders}`
                        : value === "IN_PROGRESS"
                          ? `In progress ${inProgress.length}`
                          : `Completed ${tenders.length - activeTenders}`}
                  </Button>
                ),
              )}
            </div>
            {visible.length === 0 && (
              <EmptyState
                icon={FolderKanban}
                title={
                  organisationId
                    ? "No tenders match this view yet."
                    : "Create your first organisation workspace"
                }
                body="Your organisation's tender workspaces appear here."
                action={
                  <Button
                    onClick={
                      organisationId ? () => setPage("tenders") : onCreate
                    }
                  >
                    {organisationId
                      ? "Analyse new tender"
                      : "Create organisation"}
                  </Button>
                }
              />
            )}
            <div className="space-y-3">
              {visible.map((t, i) => (
                <TenderCard
                  key={t.id}
                  tender={t}
                  index={i}
                  onClick={() => openTender(t.id)}
                />
              ))}
            </div>
          </section>

          {/* In Progress */}
          <section>
            <div className="mb-5">
              <div className="label-mono mb-1">{"// Processing"}</div>
              <h2 className="text-xl font-bold text-[#111827]">In progress</h2>
              <p className="text-sm text-[#6B7280] mt-0.5">
                Active processing and workflow activity
              </p>
            </div>
            {inProgress.length === 0 ? (
              <EmptyState
                icon={Loader2}
                title="Nothing processing right now"
                body="When you upload a new tender, extraction and assessment jobs will appear here with live progress."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage("tenders")}
                    className="border-[#E5E7EB] rounded-lg"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New tender
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {inProgress.map((t, i) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.5, ease: EASE }}
                    className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-soft"
                  >
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#111827] truncate">
                          {t.title}
                        </div>
                        <div className="text-xs text-[#6B7280] mt-0.5 font-mono">
                          {t.buyer}
                        </div>
                      </div>
                      <WorkflowStatus tender={t} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress
                        value={t.workspace?.processingProgress ?? 0}
                        className="h-1.5 flex-1"
                      />
                      <span className="text-xs text-[#6B7280] font-mono tabular-nums">
                        {t.workspace?.processingProgress ?? 0}%
                      </span>
                    </div>
                    <div className="mt-2.5 text-xs text-[#6B7280]">
                      {describeTender(t).supportingLabel}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        </motion.div>

        {/* Right column */}
        <motion.div variants={fadeUpItem} className="space-y-6">
          {/* Needs attention */}
          <section>
            <div className="mb-5">
              <div className="label-mono mb-1">{"// Alerts"}</div>
              <h2 className="text-xl font-bold text-[#111827]">
                Needs attention
              </h2>
              <p className="text-sm text-[#6B7280] mt-0.5">
                Items requiring your decision
              </p>
            </div>
            <div className="space-y-3">
              {attentionTenders.length === 0 &&
                recommendations.length === 0 && (
                  <EmptyState
                    icon={ShieldCheck}
                    title="All clear"
                    body="No current attention items were returned. This is not an eligibility or readiness approval."
                  />
                )}
              {attentionTenders.map((t) => (
                <AttentionCard
                  key={t.id}
                  tone="warning"
                  icon={AlertTriangle}
                  tag={describeTender(t).statusLabel}
                  title={describeTender(t).supportingLabel}
                  subtitle={t.title}
                  onClick={() => openTender(t.id)}
                />
              ))}
              {recommendations.map((item) => (
                <AttentionCard
                  key={item.id}
                  tone={item.priority === "HIGH" ? "danger" : "warning"}
                  icon={CircleDashed}
                  tag="Company profile"
                  title={item.action}
                  subtitle={organisationName}
                  onClick={() => {
                    if (organisationId)
                      router.push(`/settings/${organisationId}`);
                  }}
                />
              ))}
            </div>
          </section>

          {/* Upcoming deadlines */}
          <section>
            <div className="mb-5">
              <div className="label-mono mb-1">{"// Schedule"}</div>
              <h2 className="text-xl font-bold text-[#111827]">
                Upcoming deadlines
              </h2>
              <p className="text-sm text-[#6B7280] mt-0.5">
                {upcomingDeadlines.length} active
              </p>
            </div>
            <div className="space-y-2.5">
              {upcomingDeadlines.slice(0, 4).map((t, i) => {
                const days = getDeadlineDays(t.submissionDeadline) ?? 0;
                return (
                  <motion.button
                    key={t.id}
                    onClick={() => openTender(t.id)}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.1 + i * 0.06,
                      duration: 0.4,
                      ease: EASE,
                    }}
                    className="w-full text-left flex items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-3 hover:border-[var(--brand-orange)]/40 hover:shadow-soft transition-all group"
                  >
                    <div
                      className={cn(
                        "h-11 w-11 rounded-xl flex flex-col items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                        days < 14
                          ? "bg-[var(--brand-danger-soft)] text-[var(--brand-danger)]"
                          : days < 30
                            ? "bg-[var(--brand-warning-soft)] text-[var(--brand-warning)]"
                            : "bg-[var(--brand-orange-soft)] text-[var(--brand-orange)]",
                      )}
                    >
                      <span className="text-base font-extrabold leading-none tabular-nums">
                        {days}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider mt-0.5 font-mono">
                        days
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#111827] truncate">
                        {t.title}
                      </div>
                      <div className="text-[11px] text-[#6B7280] font-mono">
                        {fmtDate(t.submissionDeadline)}
                      </div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[#9CA3AF] group-hover:text-[var(--brand-orange)] transition-colors" />
                  </motion.button>
                );
              })}
            </div>
          </section>

          {/* Company readiness */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="label-mono mb-1">{"// Evidence"}</div>
                <h2 className="text-xl font-bold text-[#111827]">
                  Company readiness
                </h2>
                <p className="text-sm text-[#6B7280] mt-0.5">
                  Company profile and evidence review
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage("company-docs")}
                className="text-[var(--brand-orange)] hover:bg-[var(--brand-orange-soft)] h-7 rounded-lg font-semibold"
              >
                Manage
              </Button>
            </div>
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-soft space-y-3">
              <ReadinessRow
                label="Company profile"
                state="review"
                hint={
                  companyProgress === null
                    ? "Profile progress unavailable"
                    : `${companyProgress}% profile completion; not evidence approval`
                }
              />
              {recommendations.map((item) => (
                <ReadinessRow
                  key={item.id}
                  label={item.action}
                  state="action"
                  hint="Review company evidence"
                />
              ))}
            </div>
          </section>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ---------- Spacious summary card with hover lift ---------- */
function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
  index,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
  tone: "orange" | "danger" | "warning" | "cyan";
  hint: string;
  index: number;
}): React.JSX.Element {
  const toneMap = {
    orange: {
      bg: "bg-[var(--brand-orange-soft)]",
      text: "text-[var(--brand-orange)]",
    },
    danger: {
      bg: "bg-[var(--brand-danger-soft)]",
      text: "text-[var(--brand-danger)]",
    },
    warning: {
      bg: "bg-[var(--brand-warning-soft)]",
      text: "text-[var(--brand-warning)]",
    },
    cyan: {
      bg: "bg-[var(--brand-cyan-soft)]",
      text: "text-[var(--brand-cyan)]",
    },
  } as const;
  const cfg = toneMap[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.08, duration: 0.5, ease: EASE }}
      whileHover={{ y: -4, transition: { duration: 0.25, ease: EASE } }}
      className="group rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-soft hover:shadow-card-hover transition-shadow cursor-default"
    >
      <div className="flex items-center justify-between mb-4">
        <motion.div
          whileHover={{ scale: 1.08, rotate: -3 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center",
            cfg.bg,
            cfg.text,
          )}
        >
          <Icon className="h-5 w-5" />
        </motion.div>
        <span className="text-[10px] font-mono text-[#9CA3AF] uppercase tracking-wider">
          0{index + 1}
        </span>
      </div>
      <motion.div
        key={value}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 + index * 0.08, duration: 0.4, ease: EASE }}
        className="text-3xl font-extrabold text-[#111827] tabular-nums leading-none"
      >
        {value}
      </motion.div>
      <div className="text-sm text-[#6B7280] mt-2 font-medium">{label}</div>
      <div className="text-xs text-[#9CA3AF] mt-1 font-mono">{hint}</div>
    </motion.div>
  );
}

/* ---------- Tender card (spacious, hover-lift) ---------- */
function TenderCard({
  tender,
  index,
  onClick,
}: {
  tender: TenderSummary;
  index: number;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.5, ease: EASE }}
      whileHover={{ y: -3 }}
      className="group w-full text-left rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-[var(--brand-orange)]/30 transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="inline-flex items-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2.5 py-0.5 text-xs text-[#6B7280]">
              {describeTender(tender).supportingLabel}
            </span>
          </div>
          <div className="text-base font-bold text-[#111827] group-hover:text-[var(--brand-orange)] transition-colors leading-snug">
            {tender.title}
          </div>
          <div className="text-xs text-[#6B7280] mt-1.5 flex items-center gap-2 flex-wrap font-mono">
            <span>{tender.buyer}</span>
            <span className="text-[#9CA3AF]">·</span>
            <span>{tender.sourceTenderNumber ?? "Reference unavailable"}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <WorkflowStatus tender={tender} />
          <div className="text-xs text-[#6B7280] mt-2 font-mono">
            {formatDeadlineCountdown(tender.submissionDeadline)}
            <span className="block mt-1">
              Due {fmtDate(tender.submissionDeadline)}
            </span>
          </div>
        </div>
      </div>
      {tender.workspace?.processingProgress !== undefined &&
        tender.workspace?.processingProgress < 100 && (
          <div className="mt-4 flex items-center gap-2">
            <Progress
              value={tender.workspace?.processingProgress}
              className="h-1.5 flex-1"
            />
            <span className="text-[11px] text-[#6B7280] font-mono tabular-nums">
              {tender.workspace?.processingProgress}%
            </span>
          </div>
        )}
    </motion.button>
  );
}

/* ---------- Attention card ---------- */
function AttentionCard({
  tone,
  icon: Icon,
  tag,
  title,
  subtitle,
  onClick,
}: {
  tone: "danger" | "warning";
  icon: typeof AlertTriangle;
  tag: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}): React.JSX.Element {
  const cfg = {
    danger: {
      border: "border-[#FECACA]",
      bg: "bg-[var(--brand-danger-soft)]",
      text: "text-[var(--brand-danger)]",
    },
    warning: {
      border: "border-[#FDE68A]",
      bg: "bg-[var(--brand-warning-soft)]",
      text: "text-[var(--brand-warning)]",
    },
  }[tone];
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      className={cn(
        "w-full text-left rounded-2xl border p-4 transition-all hover:shadow-soft",
        cfg.border,
        cfg.bg,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-2 font-mono",
          cfg.text,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {tag}
      </div>
      <div className="text-sm font-semibold text-[#111827] leading-snug">
        {title}
      </div>
      <div className="text-xs text-[#6B7280] mt-1 truncate">{subtitle}</div>
    </motion.button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Loader2;
  title: string;
  body: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="text-center py-10 px-4 rounded-2xl border border-dashed border-[#E5E7EB] bg-white/50">
      <div className="mx-auto h-12 w-12 rounded-full bg-[#F3F4F6] flex items-center justify-center mb-3">
        <Icon className="h-5 w-5 text-[#6B7280]" />
      </div>
      <div className="text-sm font-semibold text-[#111827]">{title}</div>
      <p className="text-xs text-[#6B7280] mt-1 max-w-sm mx-auto leading-relaxed">
        {body}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function ReadinessRow({
  label,
  state,
  hint,
}: {
  label: string;
  state: "complete" | "review" | "action";
  hint: string;
}): React.JSX.Element {
  const cfg = {
    complete: {
      dot: "bg-[var(--brand-success)]",
      text: "text-[var(--brand-success)]",
      icon: ShieldCheck,
    },
    review: {
      dot: "bg-[var(--brand-cyan)]",
      text: "text-[var(--brand-cyan)]",
      icon: CircleDashed,
    },
    action: {
      dot: "bg-[var(--brand-warning)]",
      text: "text-[var(--brand-warning)]",
      icon: FileWarning,
    },
  }[state];
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-2.5">
      <Icon className={cn("h-4 w-4 shrink-0", cfg.text)} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-[#111827] truncate">
          {label}
        </div>
        <div className="text-[11px] text-[#6B7280] truncate font-mono">
          {hint}
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function fmtDate(iso?: string): string {
  return formatDeadline(iso);
}

function WorkflowStatus({
  tender,
}: {
  readonly tender: TenderSummary;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FED7AA] bg-[var(--brand-orange-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-orange-deep)]">
      {describeTender(tender).statusLabel}
    </span>
  );
}
