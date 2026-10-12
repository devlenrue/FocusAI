import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarClock,
  CalendarDays,
  CheckSquare2,
  Command,
  LayoutDashboard,
  LogOut,
  Plus,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import type { AuthUser } from "@/lib/types";
import { FocusMark } from "./FocusMark";
import { NewTaskModal } from "./NewTaskModal";

const navigation = [
  { to: "/", label: "Command center", icon: LayoutDashboard, end: true },
  { to: "/tasks", label: "Task workspace", icon: CheckSquare2 },
  { to: "/goals", label: "Goals & milestones", icon: Target },
  { to: "/plan", label: "Planning studio", icon: CalendarDays },
  { to: "/schedule", label: "Schedule & capacity", icon: CalendarClock },
  { to: "/focus", label: "Focus studio", icon: Timer },
];

const titleByPath: Record<string, string> = {
  "/": "Command center",
  "/tasks": "Task workspace",
  "/goals": "Goals & milestones",
  "/plan": "Planning studio",
  "/schedule": "Schedule & capacity",
  "/focus": "Focus studio",
};

export function AppShell({
  children,
  user,
  onSignOut,
  isSigningOut,
}: {
  children: React.ReactNode;
  user: AuthUser;
  onSignOut: () => void;
  isSigningOut: boolean;
}) {
  const location = useLocation();
  const [isCaptureOpen, setCaptureOpen] = useState(false);
  const title = titleByPath[location.pathname] ?? "FocusAI";
  const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "F";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace content
      </a>
      <aside className="side-rail" aria-label="Primary navigation">
        <div className="side-rail-top">
          <FocusMark />
          <span className="product-kicker">ADAPTIVE WORKSPACE</span>
          <nav className="desktop-nav">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "active" : ""}`
                  }
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
        <div
          className="rail-insight"
          aria-label="Private authenticated workspace"
        >
          <span className="rail-insight-icon">
            <Sparkles size={15} />
          </span>
          <div>
            <strong>Private workspace</strong>
            <p>Session protected</p>
          </div>
        </div>
      </aside>

      <div className="main-frame">
        <header className="top-bar">
          <div className="top-bar-context">
            <span className="top-bar-dot" aria-hidden="true" />
            <span>{title}</span>
          </div>
          <div className="top-bar-actions">
            <span className="shortcut-hint">
              <Command size={14} /> N
            </span>
            <div className="account-chip" title={user.email}>
              <span className="account-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="account-name">{user.displayName}</span>
              <button
                className="account-signout"
                type="button"
                onClick={onSignOut}
                disabled={isSigningOut}
                aria-label="Sign out securely"
              >
                <LogOut size={15} />
              </button>
            </div>
            <button
              className="button button-primary capture-button"
              type="button"
              aria-label="Capture a task"
              onClick={() => setCaptureOpen(true)}
            >
              <Plus size={17} aria-hidden="true" />
              <span>Capture</span>
            </button>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile primary navigation">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `mobile-nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} aria-hidden="true" />
              <span>{item.label.split(" ")[0]}</span>
            </NavLink>
          );
        })}
      </nav>
      <NewTaskModal
        open={isCaptureOpen}
        onClose={() => setCaptureOpen(false)}
      />
    </div>
  );
}
