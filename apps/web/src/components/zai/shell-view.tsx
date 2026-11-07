"use client";

import {
  useState,
  useRef,
  useContext,
  createContext,
  type ReactNode,
  type JSX,
} from "react";
import Link from "next/link";

import { cn } from "./utils";
import { motion, AnimatePresence, type MotionStyle } from "framer-motion";
import {
  LayoutDashboard,
  FolderKanban,
  FileStack,
  MessageSquareText,
  Settings,
  ChevronDown,
  Check,
  Search,
  HelpCircle,
  LogOut,
  UserCircle,
  Plus,
  ChevronRight,
  Clock,
  MoreHorizontal,
  FileText,
  Menu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";

export interface ShellData {
  readonly previewBrand?: boolean;
  readonly page: string;
  readonly pathname: string;
  readonly activeOrgId: string | null;
  readonly activeTenderId: string | null;
  readonly organizations: readonly {
    id: string;
    name: string;
    role: string;
    initials: string;
    color: string;
  }[];
  readonly tenders: readonly {
    id: string;
    title: string;
    buyer: string;
    isDraft: boolean;
  }[];
  readonly activeStage: string | null;
  readonly userName: string;
  readonly userEmail: string;
  readonly busy: boolean;
  readonly setPage: (page: string) => void;
  readonly hrefFor: (page: string) => string | null;
  readonly setActiveOrg: (id: string) => void;
  readonly openTender: (id: string) => void;
  readonly signOut: () => void;
}
const ShellContext = createContext<ShellData | null>(null);
function useShell(): ShellData {
  const v = useContext(ShellContext);
  if (!v) throw new Error("Missing shell context");
  return v;
}
const MotionLink = motion.create(Link);
export function ShellView({
  children,
  data,
}: {
  readonly children: ReactNode;
  readonly data: ShellData;
}): JSX.Element {
  return (
    <ShellContext.Provider value={data}>
      <ShellLayout>{children}</ShellLayout>
    </ShellContext.Provider>
  );
}
const navItems = [
  { id: "dashboard", label: "Home", code: "01", icon: LayoutDashboard },
  { id: "tenders", label: "Tenders", code: "02", icon: FolderKanban },
  { id: "company-docs", label: "Company Docs", code: "03", icon: FileStack },
  { id: "ai-chat", label: "AI Chat", code: "04", icon: MessageSquareText },
] as const;

function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const navigationOpener = useRef<HTMLButtonElement | null>(null);

  return (
    <div
      className="zai-app-shell min-h-screen bg-mesh"
      data-visual-preview={useShell().previewBrand ? "true" : undefined}
    >
      {/* Ambient aurora glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-[#FF5722]/8 blur-3xl animate-aurora" />
        <div
          className="absolute top-1/3 -right-40 h-[420px] w-[420px] rounded-full bg-[#0EA5E9]/8 blur-3xl animate-aurora"
          style={{ animationDelay: "4s" }}
        />
      </div>

      {/* Desktop sidebar */}
      <motion.div
        id="desktop-sidebar"
        className="hidden lg:block fixed inset-y-0 left-0 z-30 overflow-hidden"
        animate={{ width: desktopCollapsed ? 76 : 256 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        data-testid="desktop-sidebar"
      >
        <Sidebar className="h-full" collapsed={desktopCollapsed} />
      </motion.div>
      {/* Mobile nav sheet */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-[var(--brand-nav)] border-0 z-[70] text-white"
          overlayClassName="z-[70]"
          onCloseAutoFocus={(event) => {
            if (navigationOpener.current?.isConnected) {
              event.preventDefault();
              navigationOpener.current.focus();
            }
          }}
        >
          <SheetHeader className="px-5 pt-5">
            <SheetTitle className="text-white">Navigation</SheetTitle>
            <SheetDescription className="text-white/50 sr-only">
              Primary navigation and organisation switcher
            </SheetDescription>
          </SheetHeader>
          <div className="px-3 pb-6">
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <motion.div
        className="zai-main-with-sidebar"
        style={{ "--sidebar-width": "256px" } as MotionStyle}
        animate={{ "--sidebar-width": desktopCollapsed ? "76px" : "256px" }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <Topbar
          desktopCollapsed={desktopCollapsed}
          onToggleDesktopNav={() => setDesktopCollapsed((value) => !value)}
          onOpenMobileNav={(opener) => {
            navigationOpener.current = opener;
            setMobileNavOpen(true);
          }}
        />
        <main className="px-4 sm:px-6 lg:px-10 py-8 max-w-[1600px] mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={useNavLocationKey()}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </motion.div>
    </div>
  );
}

/* Hook to produce a stable key for page transitions */
function useNavLocationKey(): string {
  return useShell().pathname;
}

function Sidebar({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}): React.JSX.Element {
  return (
    <aside className={cn("flex flex-col bg-[var(--brand-nav)]", className)}>
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}

function SidebarContent({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}): React.JSX.Element {
  const {
    page,
    previewBrand,
    pathname,
    setPage,
    activeOrgId,
    setActiveOrg,
    activeTenderId,
    signOut,
    organizations,
    tenders,
    userName,
    userEmail,
    busy,
    hrefFor,
    activeStage,
  } = useShell();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);

  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  const recentTenders = tenders.slice(0, 3);
  const safeHref = (destination: string): string =>
    hrefFor(destination) ?? pathname;
  const followLink = (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ): void => {
    if (hrefFor(destination) === null) {
      event.preventDefault();
      setPage(destination);
    } else onNavigate?.();
  };

  return (
    <div className="zai-design flex flex-col h-full bg-grid-dark">
      {/* Brand */}
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-white/5">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="h-9 w-9 rounded-lg bg-[var(--brand-orange)] flex items-center justify-center shrink-0 shadow-glow-orange"
        >
          <FileText className="h-4.5 w-4.5 text-white" />
        </motion.div>
        <div className={cn("min-w-0", collapsed && "sr-only")}>
          <div className="text-white text-sm font-bold uppercase tracking-tight leading-tight">
            {previewBrand ? (
              <>
                BidVeda<span className="text-[var(--brand-orange)]">.</span>
              </>
            ) : (
              <>
                Tender<span className="text-[var(--brand-orange)]">.</span>Intel
              </>
            )}
          </div>
          <div className="text-[9px] text-white/40 uppercase tracking-[0.15em] font-mono">
            {previewBrand ? "Visual preview" : "Platform V2"}
          </div>
        </div>
      </div>

      {/* Org selector */}
      <div
        className={cn(
          "py-4 border-b border-white/5",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <DropdownMenu open={orgMenuOpen} onOpenChange={setOrgMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Current organisation"
              disabled={busy || organizations.length === 0}
              className={cn(
                "w-full flex items-center gap-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-all py-2.5 text-left border border-white/5",
                collapsed ? "justify-center px-1" : "px-3",
              )}
            >
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center text-[#1E1F22] text-xs font-bold shrink-0 shadow-md"
                style={{ background: activeOrg?.color ?? "#FF5722" }}
              >
                {activeOrg?.initials ?? "?"}
              </div>
              <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
                <div className="text-white text-sm font-semibold truncate">
                  {activeOrg?.name ?? "Select organisation"}
                </div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider font-mono">
                  {activeOrg?.role ?? "No organisation"}
                </div>
              </div>
              {!collapsed && (
                <ChevronDown className="h-4 w-4 text-white/40 shrink-0 transition-transform" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-64 bg-white border-[#E5E7EB] shadow-soft-lg"
          >
            <DropdownMenuLabel className="label-mono">
              Switch organisation
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => {
                  setActiveOrg(org.id);
                  setOrgMenuOpen(false);
                  onNavigate?.();
                }}
                className="gap-2.5 py-2 cursor-pointer rounded-lg"
              >
                <div
                  className="h-7 w-7 rounded-md flex items-center justify-center text-[#1E1F22] text-[10px] font-bold shrink-0"
                  style={{ background: org.color }}
                >
                  {org.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#111827] truncate">
                    {org.name}
                  </div>
                  <div className="text-[11px] text-[#6B7280]">{org.role}</div>
                </div>
                {org.id === activeOrgId && (
                  <Check className="h-4 w-4 text-[var(--brand-orange)]" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setPage("add-organisation");
                onNavigate?.();
              }}
              className="gap-2 text-[var(--brand-orange)] cursor-pointer rounded-lg"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">Add organisation</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Primary nav — industrial with code numbers */}
      <nav
        aria-label="Primary"
        className={cn("py-4 space-y-1", collapsed ? "px-2" : "px-3")}
      >
        <div
          className={cn(
            "px-3 pb-2 label-mono text-white/30",
            collapsed && "sr-only",
          )}
        >
          {"// Workspace"}
        </div>
        {navItems.map((item, i) => {
          const Icon = item.icon;
          // Tender detail pages still belong to the Tenders workspace.
          const active =
            page === item.id &&
            (activeTenderId === null || item.id === "tenders");
          return (
            <MotionLink
              key={item.id}
              href={safeHref(item.id)}
              aria-disabled={hrefFor(item.id) === null}
              aria-current={active ? "page" : undefined}
              onClick={(event) => followLink(event, item.id)}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: 0.05 * i + 0.1,
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
              className={cn(
                "relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all group",
                collapsed && "justify-center",
                active
                  ? "text-white"
                  : "text-white/55 hover:text-white hover:bg-white/5",
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-[var(--brand-orange)] shadow-glow-orange"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {!collapsed && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-[10px] font-mono shrink-0 relative z-10 transition-colors",
                    active ? "text-white/70" : "text-white/30",
                  )}
                >
                  {item.code}
                </span>
              )}
              <Icon
                className={cn(
                  "h-4.5 w-4.5 shrink-0 relative z-10 transition-transform group-hover:scale-110",
                  active ? "scale-110" : "",
                )}
              />
              <span
                className={cn(
                  "relative z-10 font-medium",
                  collapsed && "sr-only",
                )}
              >
                {item.label}
              </span>
            </MotionLink>
          );
        })}
      </nav>

      {/* Recent work */}
      <div
        className={cn(
          "px-3 py-4 border-t border-white/5 flex-1 overflow-y-auto scroll-thin no-scrollbar",
          collapsed && "hidden",
        )}
      >
        <div className="px-3 mb-2 label-mono text-white/30 flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Recent
        </div>
        <div className="space-y-0.5">
          {recentTenders.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.35 }}
              className="flex items-center rounded-lg hover:bg-white/5 group"
            >
              <Link
                aria-label={t.title}
                href={safeHref(`tender:${t.id}:overview`)}
                aria-disabled={hrefFor(`tender:${t.id}:overview`) === null}
                onClick={(event) =>
                  followLink(event, `tender:${t.id}:overview`)
                }
                className="min-w-0 flex-1 text-left px-3 py-2"
              >
                <div className="text-[13px] text-white/70 truncate group-hover:text-white transition-colors">
                  {t.title}
                </div>
                <div className="text-[10px] text-white/50 truncate font-mono uppercase tracking-wider">
                  {t.buyer}
                </div>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`Actions for ${t.title}`}
                    className="p-2 text-white/60"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <Link
                      href={safeHref(`tender:${t.id}:ask`)}
                      aria-disabled={hrefFor(`tender:${t.id}:ask`) === null}
                      onClick={(event) =>
                        followLink(event, `tender:${t.id}:ask`)
                      }
                    >
                      Tender chat
                    </Link>
                  </DropdownMenuItem>
                  {t.isDraft && (
                    <DropdownMenuItem asChild>
                      <Link
                        aria-current={
                          activeTenderId === t.id && activeStage === "draft"
                            ? "page"
                            : undefined
                        }
                        href={safeHref(`tender:${t.id}:draft`)}
                        aria-disabled={hrefFor(`tender:${t.id}:draft`) === null}
                        onClick={(event) =>
                          followLink(event, `tender:${t.id}:draft`)
                        }
                      >
                        Continue draft
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Status indicator */}
      <div
        className={cn(
          "px-3 py-2 border-t border-white/5",
          collapsed && "mt-auto",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40">
          <span className="status-dot bg-[var(--brand-success)] animate-pulse-soft" />
          <span className={cn(collapsed && "sr-only")}>
            Organisation-scoped access
          </span>
        </div>
      </div>

      {/* User */}
      <div
        className={cn(
          "py-3 border-t border-white/5",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account menu"
              className={cn(
                "w-full flex items-center gap-2.5 rounded-xl hover:bg-white/5 transition-all px-2 py-2 text-left",
                collapsed && "justify-center",
              )}
            >
              <Avatar className="h-9 w-9 border border-white/10">
                <AvatarFallback className="bg-[var(--brand-orange)] text-white text-xs font-bold">
                  {userName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((name) => name[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
                <div className="text-white text-sm font-semibold truncate">
                  {userName}
                </div>
                <div className="text-[10px] text-white/40 truncate uppercase tracking-wider font-mono">
                  {activeOrg?.role ?? "Member"} {activeOrg?.name ?? ""}
                </div>
              </div>
              {!collapsed && <ChevronDown className="h-4 w-4 text-white/40" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 bg-white border-[#E5E7EB] shadow-soft-lg"
          >
            <DropdownMenuLabel className="label-mono">
              {userEmail}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {activeOrgId && (
              <DropdownMenuItem asChild>
                <Link
                  href={safeHref("onboarding")}
                  aria-disabled={hrefFor("onboarding") === null}
                  onClick={(event) => followLink(event, "onboarding")}
                >
                  Company profile
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="gap-2 cursor-pointer rounded-lg"
              onClick={() => {
                setPage("account");
                onNavigate?.();
              }}
            >
              <UserCircle className="h-4 w-4" /> Account
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 cursor-pointer rounded-lg"
              onClick={() => {
                setPage("settings");
                onNavigate?.();
              }}
            >
              <Settings className="h-4 w-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setPage("help")}
              className="gap-2 cursor-pointer rounded-lg"
            >
              <HelpCircle className="h-4 w-4" /> Help & docs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-[var(--brand-danger)] cursor-pointer rounded-lg"
              disabled={busy}
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Topbar({
  onOpenMobileNav,
  desktopCollapsed,
  onToggleDesktopNav,
}: {
  onOpenMobileNav: (opener: HTMLButtonElement) => void;
  desktopCollapsed: boolean;
  onToggleDesktopNav: () => void;
}): React.JSX.Element {
  const {
    page,
    activeTenderId,
    activeOrgId,
    setPage,
    organizations,
    tenders,
    openTender,
  } = useShell();
  const [search, setSearch] = useState("");
  const matches = search.trim()
    ? tenders
        .filter((tender) =>
          `${tender.title} ${tender.buyer}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
        .slice(0, 5)
    : [];
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  const crumbs: { label: string; onClick?: () => void }[] = [
    {
      label: activeOrg?.name ?? "Workspace",
      onClick: () => setPage("dashboard"),
    },
  ];

  if (page === "tenders") {
    crumbs.push({
      label: "Tenders",
      onClick: () => setPage("tenders"),
    });
    if (activeTenderId) {
      const t = tenders.find((x) => x.id === activeTenderId);
      if (t) crumbs.push({ label: t.title });
    }
  } else if (page === "company-docs") {
    crumbs.push({ label: "Company Docs" });
  } else if (page === "ai-chat") {
    crumbs.push({ label: "AI Chat" });
  } else if (page === "settings") {
    crumbs.push({ label: "Settings" });
  } else if (page === "dashboard") {
    crumbs.push({ label: "Home" });
  }

  return (
    <header className="zai-design sticky top-0 z-20 h-16 bg-white border-b border-[#E5E7EB]/60 shadow-[0_1px_8px_rgb(17_24_39_/_0.04)]">
      <div className="h-full px-4 sm:px-6 lg:px-10 flex items-center gap-3">
        <button
          aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!desktopCollapsed}
          aria-controls="desktop-sidebar"
          onClick={onToggleDesktopNav}
          className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#F3F4F6] text-[#111827] transition-colors"
          type="button"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          aria-label="Open navigation"
          onClick={(event) => onOpenMobileNav(event.currentTarget)}
          className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-[#F3F4F6] text-[#111827] transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
              )}
              {c.onClick ? (
                <button
                  onClick={c.onClick}
                  className="text-[#6B7280] hover:text-[#111827] truncate nav-underline"
                >
                  {c.label}
                </button>
              ) : (
                <span className="text-[#111827] font-semibold truncate">
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>

        {/* Search */}
        <div className="hidden md:flex items-center relative group">
          <Search className="absolute left-3 h-4 w-4 text-[#9CA3AF] group-focus-within:text-[var(--brand-orange)] transition-colors" />
          <input
            aria-label="Search tenders"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tenders…"
            className="h-9 w-56 lg:w-72 rounded-xl border border-[#E5E7EB] bg-white/60 pl-9 pr-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[var(--brand-orange)]/30 focus:border-[var(--brand-orange)] focus:bg-white transition-all"
          />
          {search.trim() && (
            <div
              aria-label="Tender search results"
              className="absolute top-11 right-0 w-72 rounded-xl border border-[#E5E7EB] bg-white shadow-xl p-2 z-30"
            >
              {matches.length === 0 ? (
                <p className="p-2 text-sm text-[#6B7280]">
                  No matching tenders in this organisation.
                </p>
              ) : (
                matches.map((tender) => (
                  <button
                    key={tender.id}
                    className="block w-full text-left p-2 rounded-lg hover:bg-[#FFF3EE] text-sm"
                    onClick={() => {
                      setSearch("");
                      openTender(tender.id);
                    }}
                  >
                    {tender.title}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Help"
          onClick={() => setPage("help")}
          className="text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] rounded-lg hidden sm:inline-flex"
        >
          <HelpCircle className="h-4.5 w-4.5" />
        </Button>
      </div>
    </header>
  );
}
