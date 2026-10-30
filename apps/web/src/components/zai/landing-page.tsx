"use client";

import { useRouter } from "next/navigation";
import { faqs } from "./landing-content";
import { Button } from "./ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import {
  FileText,
  ScanLine,
  ShieldCheck,
  ClipboardList,
  MessageSquareText,
  FilePenLine,
  GitMerge,
  Download,
  ArrowRight,
  CheckCircle2,
  Lock,
  FileSearch,
  AlertTriangle,
  Building2,
  Users,
  Sparkles,
  ChevronRight,
  Quote,
} from "lucide-react";

export function LandingPage(): React.JSX.Element {
  const router = useRouter();

  const go = (mode: "login" | "register"): void => {
    router.push(`/${mode}`);
  };

  return (
    <div className="zai-design min-h-screen bg-[#F9FAFB] flex flex-col">
      <LandingNav onCta={go} />
      <main className="flex-1">
        <Hero onCta={go} />
        <p className="text-center text-xs text-[#6B7280] px-6">
          Illustrative workflow previews; not customer records or eligibility
          decisions.
        </p>
        <Capabilities />
        <Workflow />
        <EligibilitySection />
        <ChatPreview />
        <SecuritySection />
        <AuditTrailSection />
        <FaqSection />
        <CtaBanner onCta={go} />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ---------- Top nav ---------- */
function LandingNav({
  onCta,
}: {
  onCta: (m: "login" | "register") => void;
}): React.JSX.Element {
  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-[#E5E7EB]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] flex items-center justify-center">
            <FileText className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-[#111827] text-sm font-semibold leading-tight">
              Tender Intelligence
            </div>
            <div className="text-[10px] text-[#6B7280] uppercase tracking-wider leading-tight">
              Platform V2
            </div>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-7 text-sm text-[#6B7280]">
          <a
            href="#capabilities"
            className="hover:text-[#111827] transition-colors"
          >
            Capabilities
          </a>
          <a
            href="#workflow"
            className="hover:text-[#111827] transition-colors"
          >
            How it works
          </a>
          <a
            href="#security"
            className="hover:text-[#111827] transition-colors"
          >
            Security
          </a>
          <a href="#faq" className="hover:text-[#111827] transition-colors">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => onCta("login")}
            className="text-[#111827] hover:bg-[#F3F4F6] hidden sm:inline-flex"
          >
            Sign in
          </Button>
          <Button
            onClick={() => onCta("register")}
            className="bg-[#FF5722] hover:bg-[#E64A19] text-white"
          >
            Get Started
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ---------- Hero ---------- */
function Hero({
  onCta,
}: {
  onCta: (m: "login" | "register") => void;
}): React.JSX.Element {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />
      <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-[#0EA5E9]/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-[#FF5722]/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#BAE6FD] bg-[var(--brand-orange-soft)] px-3 py-1 text-xs font-medium text-[var(--brand-orange-deep)] mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              AI-powered, evidence-backed tender analysis
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-bold leading-[1.08] tracking-tight text-[#111827]">
              Turn complex tender documents into{" "}
              <span className="text-gradient-brand">
                clear, actionable decisions.
              </span>
            </h1>
            <p className="mt-6 text-lg text-[#6B7280] leading-relaxed max-w-xl">
              Upload your tender, understand critical requirements, compare
              company evidence, identify risks and prepare reviewable bid
              responses — all in one intelligent workspace.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button
                size="lg"
                onClick={() => onCta("register")}
                className="bg-[#FF5722] hover:bg-[#E64A19] text-white h-12 px-7 text-base"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  document
                    .getElementById("workflow")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="h-12 px-7 text-base border-[#E5E7EB] text-[#111827] hover:bg-[#F3F4F6] bg-white"
              >
                Explore How It Works
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#6B7280]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--brand-success)]" />
                Citation-backed AI
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--brand-success)]" />
                Human-in-the-loop review
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[var(--brand-success)]" />
                Private document storage
              </span>
            </div>
            <p className="mt-5 text-xs text-[#9CA3AF] max-w-lg leading-relaxed">
              Independent of GeM, CPPP and government authorities. The platform
              does not guarantee eligibility, compliance or bid success.
            </p>
          </div>

          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

function ProductPreview(): React.JSX.Element {
  return (
    <div
      className="relative animate-fade-up"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl shadow-[#FF5722]/10 overflow-hidden">
        {/* Window chrome */}
        <div className="h-9 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center px-4 gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FECACA]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FDE68A]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#A7F3D0]" />
          <div className="flex-1 text-center text-[11px] text-[#6B7280]">
            app.tenderintelligence.in / tenders / pwd-pune-2025
          </div>
        </div>
        {/* Body */}
        <div className="grid grid-cols-12 min-h-[420px]">
          {/* mini sidebar */}
          <div className="col-span-3 bg-[var(--brand-nav)] p-3 hidden sm:block">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] mb-3" />
            <div className="space-y-1.5">
              {["Home", "Tenders", "Company Docs", "AI Chat"].map((l, i) => (
                <div
                  key={l}
                  className={`text-xs rounded-md px-2.5 py-1.5 ${
                    i === 1 ? "bg-[#FF5722] text-white" : "text-white/60"
                  }`}
                >
                  {l}
                </div>
              ))}
            </div>
            <div className="mt-5 text-[9px] uppercase tracking-wider text-white/30 px-2.5">
              Recent
            </div>
            <div className="mt-1.5 space-y-1">
              {["PWD Pune Building", "MSEDCL 33kV", "DIT AMC"].map((t) => (
                <div
                  key={t}
                  className="text-[10px] text-white/50 px-2.5 truncate"
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
          {/* main */}
          <div className="col-span-12 sm:col-span-9 p-4 sm:p-5 bg-[#F9FAFB]">
            <div className="text-[11px] text-[#6B7280] mb-1">
              Tender workspace
            </div>
            <div className="text-sm font-semibold text-[#111827] leading-snug mb-3">
              Construction of Administrative Building at Regional Office, Pune
            </div>
            {/* status cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <MiniStat label="Submission" value="02 Dec" tone="warning" />
              <MiniStat label="Verified" value="3/7" tone="success" />
              <MiniStat label="Blockers" value="2" tone="danger" />
            </div>
            {/* eligibility row */}
            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 mb-3">
              <div className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
                Eligibility assessment
              </div>
              <div className="space-y-1.5">
                <EligRow label="Min. turnover INR 4.5 Cr" state="verified" />
                <EligRow label="Similar work INR 2.25 Cr" state="likely_met" />
                <EligRow label="PM with 10+ yrs exp." state="conflict" />
                <EligRow label="EMD INR 4,50,000" state="missing" />
              </div>
            </div>
            {/* AI chat snippet */}
            <div className="rounded-lg border border-[#BAE6FD] bg-[var(--brand-orange-soft)] p-3">
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--brand-orange-deep)] font-semibold uppercase tracking-wider mb-1.5">
                <Sparkles className="h-3 w-3" /> AI assistant
              </div>
              <div className="text-xs text-[#111827] leading-relaxed">
                The submission deadline is{" "}
                <span className="font-semibold">02 December 2025</span>, revised
                by Corrigendum-1. EMD validity must extend 45 days beyond this
                date.
                <span className="inline-flex items-center gap-1 ml-1 rounded border border-[#BAE6FD] bg-white px-1 py-0.5 text-[10px] text-[var(--brand-orange-deep)] font-mono">
                  <FileText className="h-2.5 w-2.5" /> p.1
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* floating accent */}
      <div className="absolute -bottom-5 -left-5 hidden sm:block rounded-xl border border-[#E5E7EB] bg-white shadow-xl p-3 w-56">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="h-6 w-6 rounded-md bg-[var(--brand-success-soft)] flex items-center justify-center">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--brand-success)]" />
          </div>
          <div className="text-[11px] font-semibold text-[#111827]">
            Human review
          </div>
        </div>
        <div className="text-[10px] text-[#6B7280] leading-relaxed">
          3 requirements verified by Amit K. on 28 Oct 2025 — overrides
          recorded.
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warning" | "success" | "danger";
}): React.JSX.Element {
  const tones = {
    warning:
      "border-[#FDE68A] bg-[var(--brand-warning-soft)] text-[var(--brand-warning)]",
    success:
      "border-[#A7F3D0] bg-[var(--brand-success-soft)] text-[var(--brand-success)]",
    danger:
      "border-[#FECACA] bg-[var(--brand-danger-soft)] text-[var(--brand-danger)]",
  } as const;
  return (
    <div className={`rounded-lg border p-2 ${tones[tone]}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function EligRow({
  label,
  state,
}: {
  label: string;
  state: "verified" | "likely_met" | "conflict" | "missing";
}): React.JSX.Element {
  const map = {
    verified: { dot: "bg-[var(--brand-success)]", text: "Verified" },
    likely_met: { dot: "bg-[#FF5722]", text: "Likely met" },
    conflict: { dot: "bg-[var(--brand-danger)]", text: "Conflict" },
    missing: { dot: "bg-[var(--brand-warning)]", text: "Missing" },
  } as const;
  const cfg = map[state];
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[#111827] truncate pr-2">{label}</span>
      <span className="flex items-center gap-1.5 shrink-0 text-[#6B7280]">
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.text}
      </span>
    </div>
  );
}

/* ---------- Capabilities ---------- */
const capabilities = [
  {
    icon: FileSearch,
    title: "Tender document intelligence",
    body: "Upload PDFs, DOCX, XLSX and approved ZIPs. The platform extracts structured eligibility, financial, technical and contractual clauses — every fact linked to its source.",
    tone: "info",
  },
  {
    icon: AlertTriangle,
    title: "Risk and deadline visibility",
    body: "A risk register surfaces financial exposure, technical constraints, deadline conflicts and document gaps before you commit to bid preparation.",
    tone: "warning",
  },
  {
    icon: GitMerge,
    title: "Evidence-based eligibility comparison",
    body: "Each tender requirement is matched against approved company evidence. Assessment states range from Verified to Conflict to Human review required.",
    tone: "ai",
  },
  {
    icon: ClipboardList,
    title: "Document-readiness checklists",
    body: "Actionable checklists derived from actual tender requirements and outstanding evidence — a work-management surface, not a compliance score.",
    tone: "success",
  },
  {
    icon: MessageSquareText,
    title: "Citation-backed AI assistance",
    body: "Ask questions about the tender and get source-grounded answers. Every factual claim links to document, version, page and clause.",
    tone: "ai",
  },
  {
    icon: FilePenLine,
    title: "Fact-constrained draft preparation",
    body: "Generate structured bid drafts that explicitly mark unsupported material as placeholders. The system cannot invent turnover, certifications or experience.",
    tone: "info",
  },
  {
    icon: ShieldCheck,
    title: "Human review and controlled export",
    body: "Authoritative conclusions are set by human reviewers, not AI. Independent review gates export. Every override is recorded with rationale.",
    tone: "success",
  },
  {
    icon: ScanLine,
    title: "Corrigenda and version integrity",
    body: "Corrigenda stay associated with the tender, preserve the original, flag conflicts, and invalidate stale analysis and approvals automatically.",
    tone: "neutral",
  },
];

function Capabilities(): React.JSX.Element {
  return (
    <section
      id="capabilities"
      className="py-20 lg:py-28 bg-white border-y border-[#E5E7EB]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Capabilities"
          title="Everything you need to evaluate and prepare a tender"
          subtitle="A focused, evidence-first workspace — not a generic chatbot. Built for MSMEs, tender executives and reviewers who need to act with confidence."
        />
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {capabilities.map((c) => (
            <CapabilityCard key={c.title} {...c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CapabilityCard({
  icon: Icon,
  title,
  body,
  tone,
}: {
  icon: typeof FileSearch;
  title: string;
  body: string;
  tone: string;
}): React.JSX.Element {
  const toneMap: Record<string, string> = {
    info: "bg-[#E8F1FE] text-[#FF5722]",
    ai: "bg-[var(--brand-orange-soft)] text-[var(--brand-orange-deep)]",
    success: "bg-[var(--brand-success-soft)] text-[var(--brand-success)]",
    warning: "bg-[var(--brand-warning-soft)] text-[var(--brand-warning)]",
    neutral: "bg-[#F3F4F6] text-[#6B7280]",
  };
  return (
    <div className="group rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#FF5722]/40 hover:shadow-lg hover:shadow-[#FF5722]/5 transition-all">
      <div
        className={`h-10 w-10 rounded-lg flex items-center justify-center mb-4 ${toneMap[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-[#111827] font-semibold text-base mb-2 leading-snug">
        {title}
      </h3>
      <p className="text-sm text-[#6B7280] leading-relaxed">{body}</p>
    </div>
  );
}

/* ---------- Workflow ---------- */
const workflowSteps = [
  { icon: Download, label: "Upload", desc: "PDF, DOCX, XLSX, ZIP" },
  { icon: ScanLine, label: "Extract", desc: "OCR + structured parsing" },
  { icon: FileSearch, label: "Assess", desc: "Eligibility & risk analysis" },
  { icon: FilePenLine, label: "Prepare", desc: "Draft with citations" },
  { icon: ShieldCheck, label: "Review", desc: "Independent sign-off" },
  { icon: Download, label: "Export", desc: "Controlled review package" },
];

function Workflow(): React.JSX.Element {
  return (
    <section id="workflow" className="py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="From a 100-page tender to a reviewable response"
          subtitle="A clear, sequential workflow. Each stage is grounded in real backend state — no fabricated progress, no fake completion."
        />
        <div className="mt-14">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-3">
            {workflowSteps.map((s, i) => (
              <div key={s.label} className="relative">
                <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 h-full">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-[#FF5722]/10 to-[#0EA5E9]/10 flex items-center justify-center">
                      <s.icon className="h-5 w-5 text-[#FF5722]" />
                    </div>
                    <span className="text-xs font-mono text-[#9CA3AF]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="text-[#111827] font-semibold text-sm">
                    {s.label}
                  </div>
                  <div className="text-xs text-[#6B7280] mt-0.5">{s.desc}</div>
                </div>
                {i < workflowSteps.length - 1 && (
                  <ChevronRight className="hidden lg:block absolute top-1/2 -right-2.5 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] z-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Eligibility section ---------- */
function EligibilitySection(): React.JSX.Element {
  return (
    <section className="py-20 lg:py-28 bg-white border-y border-[#E5E7EB]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <SectionHeading
            eyebrow="Eligibility comparison"
            title="Requirements meet evidence — not assumptions"
            subtitle="Each tender requirement is matched against your approved company evidence. Six explicit assessment states make uncertainty legible, never hidden behind a single percentage."
            align="left"
          />
          <div className="mt-8 space-y-3">
            {[
              {
                state: "verified",
                desc: "Current reviewed evidence supports the requirement.",
              },
              {
                state: "likely_met",
                desc: "Evidence suggests a match but confirmation is required.",
              },
              {
                state: "missing",
                desc: "Supporting evidence is unavailable or insufficient.",
              },
              {
                state: "conflict",
                desc: "Available evidence contradicts the requirement.",
              },
              {
                state: "human_review",
                desc: "Ambiguity or risk prevents safe automated resolution.",
              },
              {
                state: "not_applicable",
                desc: "Reviewed determination that the condition does not apply.",
              },
            ].map((r) => (
              <div
                key={r.state}
                className="flex items-start gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3.5"
              >
                <EligDot state={r.state} />
                <div>
                  <div className="text-sm font-semibold text-[#111827] capitalize">
                    {r.state.replace(/_/g, " ")}
                  </div>
                  <div className="text-xs text-[#6B7280] leading-relaxed">
                    {r.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-5 shadow-xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
              Evidence matrix
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                <div className="col-span-6">Requirement</div>
                <div className="col-span-3">Evidence</div>
                <div className="col-span-3">Assessment</div>
              </div>
              {[
                {
                  req: "Min. turnover INR 4.5 Cr",
                  ev: "Audited FY22-24",
                  st: "verified",
                },
                {
                  req: "Similar work INR 2.25 Cr",
                  ev: "Magarpatta cert.",
                  st: "likely_met",
                },
                { req: "ISO 9001 valid", ev: "TUV NORD cert.", st: "verified" },
                {
                  req: "PM with 10+ yrs exp.",
                  ev: "R. Deshmukh (8y)",
                  st: "conflict",
                },
                { req: "EMD INR 4,50,000", ev: "—", st: "missing" },
                { req: "GSTR-9 latest FY", ev: "Older FY", st: "human_review" },
              ].map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-[#E5E7EB] last:border-0 text-xs items-center"
                >
                  <div className="col-span-6 text-[#111827] font-medium truncate">
                    {row.req}
                  </div>
                  <div className="col-span-3 text-[#6B7280] truncate">
                    {row.ev}
                  </div>
                  <div className="col-span-3">
                    <EligDot state={row.st} compact />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EligDot({
  state,
  compact,
}: {
  state: string;
  compact?: boolean;
}): React.JSX.Element {
  const map: Record<string, { dot: string; label: string; text: string }> = {
    verified: {
      dot: "bg-[var(--brand-success)]",
      label: "Verified",
      text: "text-[var(--brand-success)]",
    },
    likely_met: {
      dot: "bg-[#FF5722]",
      label: "Likely met",
      text: "text-[#FF5722]",
    },
    missing: {
      dot: "bg-[var(--brand-warning)]",
      label: "Missing",
      text: "text-[var(--brand-warning)]",
    },
    conflict: {
      dot: "bg-[var(--brand-danger)]",
      label: "Conflict",
      text: "text-[var(--brand-danger)]",
    },
    human_review: {
      dot: "bg-[var(--brand-orange-deep)]",
      label: "Human review",
      text: "text-[var(--brand-orange-deep)]",
    },
    not_applicable: {
      dot: "bg-[#6B7280]",
      label: "N/A",
      text: "text-[#6B7280]",
    },
  };
  const cfg = map[state] ?? {
    dot: "bg-[#6B7280]",
    label: "Unknown",
    text: "text-[#6B7280]",
  };
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}
      >
        <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    );
  }
  return <span className={`mt-1 h-3 w-3 rounded-full ${cfg.dot} block`} />;
}

/* ---------- Chat preview ---------- */
function ChatPreview(): React.JSX.Element {
  return (
    <section className="py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-14 items-center">
        <div className="order-2 lg:order-1">
          <div className="rounded-2xl border border-[#BAE6FD] bg-[var(--brand-orange-soft)] p-5 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#0EA5E9] to-[#FF5722] flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#111827]">
                  Tender assistant
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  Grounded in PWD/PUN/2025/CR-4421
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-br-md bg-[#FF5722] text-white text-sm px-3.5 py-2.5 max-w-[80%]">
                  Which requirements lack supporting company evidence?
                </div>
              </div>
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white border border-[#E5E7EB] text-sm text-[#111827] px-3.5 py-2.5 max-w-[88%]">
                  Two requirements currently lack supporting evidence:
                  <ol className="mt-2 space-y-1.5 list-decimal list-inside text-[13px]">
                    <li>
                      EMD of INR 4,50,000 — marked Missing.
                      <CiteTag>p.9</CiteTag>
                    </li>
                    <li>
                      PM with 10+ yrs experience — marked Conflict (nominee has
                      8 yrs).
                      <CiteTag>p.8</CiteTag>
                    </li>
                  </ol>
                  <div className="mt-2.5 pt-2.5 border-t border-[#E5E7EB] text-[11px] text-[#6B7280]">
                    Additionally, the annual GST return is marked Human review
                    required.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeading
            eyebrow="Citation-backed AI"
            title="Ask anything. Get answers you can trace."
            subtitle="Every factual claim in an AI response links to a specific citation — document, version, page, clause and excerpt. If the assistant cannot find adequate evidence, it says so explicitly."
            align="left"
          />
          <ul className="mt-8 space-y-3">
            {[
              "Retrieves only authorized sources for the current organisation and tender context",
              "Distinguishes AI-generated proposals from authoritative human-reviewed conclusions",
              "Identifies retrieval-only fallback clearly when AI generation is unavailable",
              "Never fabricates citations or sources",
            ].map((p) => (
              <li key={p} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-[var(--brand-success)] shrink-0 mt-0.5" />
                <span className="text-sm text-[#111827] leading-relaxed">
                  {p}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CiteTag({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 rounded border border-[#BAE6FD] bg-[var(--brand-orange-soft)] px-1 py-0.5 text-[10px] text-[var(--brand-orange-deep)] font-mono align-middle">
      <FileText className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

/* ---------- Security ---------- */
function SecuritySection(): React.JSX.Element {
  return (
    <section
      id="security"
      className="py-20 lg:py-28 bg-[var(--brand-nav)] text-white relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-dots opacity-30 pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 mb-5">
            <Lock className="h-3.5 w-3.5" /> Security & trust
          </div>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
            Sensitive documents deserve a real security model
          </h2>
          <p className="mt-4 text-white/60 leading-relaxed">
            Security is a product requirement, not a marketing badge. Every
            record is organisation-scoped, every binary stays in private
            storage, every review decision is traceable.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              icon: Building2,
              title: "Organisation-scoped permissions",
              body: "Every business record belongs to an authorised organisation. Permissions are enforced by the backend, never the UI alone.",
            },
            {
              icon: Lock,
              title: "Private object storage",
              body: "Document binaries live in S3-compatible private storage. Downloads are authenticated and time-bound — never public URLs.",
            },
            {
              icon: ShieldCheck,
              title: "Malware-scanned uploads",
              body: "Every upload is validated, bounded, and scanned by ClamAV before content becomes available for analysis.",
            },
            {
              icon: ScanLine,
              title: "Versioned provenance",
              body: "Source citations retain exact version provenance. Adding new documents invalidates stale analysis and approvals.",
            },
            {
              icon: Users,
              title: "Independent review gates",
              body: "A requester cannot self-approve an action requiring independent review. Authoritative decisions remain human.",
            },
            {
              icon: FileText,
              title: "Traceable overrides",
              body: "Every human override of an AI proposal is recorded with rationale, actor and timestamp — for the life of the record.",
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition-colors"
            >
              <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center mb-4">
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-white font-semibold text-base mb-2">
                {s.title}
              </h3>
              <p className="text-sm text-white/55 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Audit trail ---------- */
function AuditTrailSection(): React.JSX.Element {
  return (
    <section className="py-20 lg:py-28 bg-white border-y border-[#E5E7EB]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Traceability"
          title="Every decision has a story — and you can read it"
          subtitle="From upload to export, every action is recorded. Audit trail entries show who did what, when, and against which source version."
        />
        <div className="mt-14 relative">
          <div className="absolute left-4 top-2 bottom-2 w-px bg-[#E5E7EB]" />
          <div className="space-y-5">
            {[
              {
                actor: "Riya Sharma",
                action: "uploaded Corrigendum-1.pdf",
                when: "27 Oct 2025, 15:02",
                tone: "info",
              },
              {
                actor: "System",
                action: "extracted deadline revision; flagged EMD validity",
                when: "27 Oct 2025, 15:08",
                tone: "ai",
              },
              {
                actor: "System",
                action:
                  "assessed 7 requirements: 3 verified, 1 conflict, 1 missing",
                when: "27 Oct 2025, 15:14",
                tone: "ai",
              },
              {
                actor: "Amit Kulkarni",
                action: "verified 'Min. turnover INR 4.5 Cr' with rationale",
                when: "28 Oct 2025, 10:30",
                tone: "success",
              },
              {
                actor: "Riya Sharma",
                action: "set pursuit decision: Continue",
                when: "28 Oct 2025, 12:05",
                tone: "info",
              },
              {
                actor: "Vikram Menon",
                action: "requested independent readiness review",
                when: "29 Oct 2025, 09:14",
                tone: "warning",
              },
            ].map((e, i) => (
              <div key={i} className="relative pl-12">
                <div
                  className={`absolute left-0 top-1 h-8 w-8 rounded-full border-2 border-white flex items-center justify-center ${
                    e.tone === "ai"
                      ? "bg-[var(--brand-orange-soft)]"
                      : e.tone === "success"
                        ? "bg-[var(--brand-success-soft)]"
                        : e.tone === "warning"
                          ? "bg-[var(--brand-warning-soft)]"
                          : "bg-[#E8F1FE]"
                  }`}
                >
                  <div
                    className={`h-2 w-2 rounded-full ${
                      e.tone === "ai"
                        ? "bg-[var(--brand-orange-deep)]"
                        : e.tone === "success"
                          ? "bg-[var(--brand-success)]"
                          : e.tone === "warning"
                            ? "bg-[var(--brand-warning)]"
                            : "bg-[#FF5722]"
                    }`}
                  />
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm text-[#111827]">
                      <span className="font-semibold">{e.actor}</span>{" "}
                      <span className="text-[#6B7280]">{e.action}</span>
                    </div>
                    <div className="text-xs text-[#9CA3AF] font-mono">
                      {e.when}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
function FaqSection(): React.JSX.Element {
  return (
    <section id="faq" className="py-20 lg:py-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="FAQ"
          title="Honest answers to common questions"
          subtitle="We do not advertise capabilities we do not have. If something is not implemented, we say so."
        />
        <Accordion type="single" collapsible className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem
              key={i}
              value={`q-${i}`}
              className="rounded-lg border border-[#E5E7EB] bg-white px-5"
            >
              <AccordionTrigger className="text-left text-[#111827] font-semibold hover:no-underline py-5 text-base">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-[#6B7280] leading-relaxed text-sm pb-5">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ---------- CTA banner ---------- */
function CtaBanner({
  onCta,
}: {
  onCta: (m: "login" | "register") => void;
}): React.JSX.Element {
  return (
    <section className="py-20 lg:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] p-10 lg:p-16 text-center">
          <div className="absolute inset-0 bg-dots opacity-20 pointer-events-none" />
          <div className="relative">
            <Quote className="h-8 w-8 text-white/40 mx-auto mb-5" />
            <h2 className="text-3xl lg:text-4xl font-bold text-[#1E1F22] tracking-tight max-w-2xl mx-auto leading-tight">
              Understand your tenders. Verify your evidence. Prepare with
              confidence.
            </h2>
            <p className="mt-5 text-[#1E1F22] max-w-xl mx-auto leading-relaxed">
              Confidence comes from traceability and human review — never from
              an unsupported AI guarantee.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                onClick={() => onCta("register")}
                className="bg-white text-[#FF5722] hover:bg-white/90 h-12 px-8 text-base"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => onCta("login")}
                className="border-[#1E1F22]/60 text-[#1E1F22] hover:bg-white/10 h-12 px-8 text-base bg-transparent"
              >
                Sign in
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function LandingFooter(): React.JSX.Element {
  return (
    <footer className="bg-white border-t border-[#E5E7EB] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#FF5722] to-[#0EA5E9] flex items-center justify-center">
                <FileText className="h-4 w-4 text-white" />
              </div>
              <div className="text-[#111827] text-sm font-semibold">
                Tender Intelligence Platform
              </div>
            </div>
            <p className="text-sm text-[#6B7280] leading-relaxed">
              An AI-powered tender intelligence workspace for Indian MSMEs,
              tender executives and reviewers.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              "Capabilities",
              "How it works",
              "Security",
              "Pricing",
              "Changelog",
            ]}
          />
          <FooterCol
            title="Resources"
            links={[
              "Documentation",
              "API reference",
              "Onboarding guide",
              "Status",
              "Support",
            ]}
          />
          <FooterCol
            title="Company"
            links={["About", "Privacy", "Terms", "Responsible AI", "Contact"]}
          />
        </div>
        <div className="mt-10 pt-6 border-t border-[#E5E7EB] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[#9CA3AF] leading-relaxed max-w-2xl">
            Independent of GeM, CPPP and government authorities. The platform
            does not perform automated portal scraping, autonomous bid
            submission, or guarantee eligibility, compliance or bid success.
          </p>
          <p className="text-xs text-[#9CA3AF]">
            © 2025 Tender Intelligence Platform
          </p>
        </div>
      </div>
    </footer>
  );
}

const footerDestinations: Readonly<Record<string, string>> = {
  Capabilities: "#capabilities",
  "How it works": "#workflow",
  Security: "#security",
  FAQ: "#faq",
  "Responsible AI": "#security",
};
function FooterCol({
  title,
  links,
}: {
  title: string;
  links: string[];
}): React.JSX.Element {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[#111827] mb-3">
        {title}
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l}>
            <span className="text-sm text-[#6B7280]">
              {footerDestinations[l] ? (
                <a
                  href={footerDestinations[l]}
                  className="text-sm text-[#6B7280] hover:text-[#FF5722] transition-colors"
                >
                  {l}
                </a>
              ) : (
                <span aria-disabled="true" title="No public page available">
                  {l}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Shared ---------- */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  align?: "center" | "left";
}): React.JSX.Element {
  return (
    <div
      className={
        align === "center" ? "text-center max-w-2xl mx-auto" : "max-w-2xl"
      }
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-[#FF5722] mb-3">
        {eyebrow}
      </div>
      <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-[#111827] leading-tight">
        {title}
      </h2>
      <p className="mt-4 text-[#6B7280] leading-relaxed">{subtitle}</p>
    </div>
  );
}
