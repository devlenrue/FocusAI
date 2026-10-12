import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Clock3,
  Focus,
  ListChecks,
  Play,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatClock, formatDate, formatDuration } from "@/lib/format";
import type { Readiness, Recommendation } from "@/lib/types";
import { IntelligenceBadge } from "@/components/FocusMark";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { PriorityPill, TaskMeta } from "@/components/TaskVisuals";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function RecommendationCard({
  recommendation,
  rank,
  onStart,
}: {
  recommendation: Recommendation;
  rank: number;
  onStart: () => void;
}) {
  const primaryReason =
    recommendation.reasons[0]?.message ??
    "It is the clearest next step in your active work.";
  return (
    <article className="priority-card">
      <div className="priority-card-top">
        <span className="priority-rank">0{rank}</span>
        <PriorityPill priority={recommendation.task.priority} />
      </div>
      <h3>{recommendation.task.title}</h3>
      <p>{primaryReason}</p>
      <TaskMeta task={recommendation.task} />
      <button className="text-action" type="button" onClick={onStart}>
        Focus on this <ArrowRight size={15} />
      </button>
    </article>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [readiness, setReadiness] = useState<Readiness>("steady");
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
  });

  if (dashboardQuery.isPending)
    return <LoadingState label="Reading your actual workspace…" />;
  if (dashboardQuery.isError)
    return (
      <ErrorState
        message={dashboardQuery.error.message}
        onRetry={() => dashboardQuery.refetch()}
      />
    );

  const dashboard = dashboardQuery.data;
  const completionRate = dashboard.tasks.total
    ? Math.round((dashboard.tasks.completed / dashboard.tasks.total) * 100)
    : 0;
  const planBlocks = dashboard.plan?.blocks ?? [];

  return (
    <div className="dashboard-page page-stack">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">{formatDate(dashboard.date)}</span>
          <h1>
            {greeting()}. <span>Find the next clear move.</span>
          </h1>
          <p>
            FocusAI weighs urgency, impact, capacity, and your selected
            readiness—then leaves the decision in your hands.
          </p>
        </div>
        <div
          className="readiness-control"
          aria-label="Energy readiness check-in"
        >
          <span className="readiness-label">
            <BrainCircuit size={15} /> Readiness
          </span>
          <div className="segmented-control">
            {(["low", "steady", "high"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={readiness === option ? "selected" : ""}
                aria-pressed={readiness === option}
                onClick={() => setReadiness(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            className="readiness-use"
            type="button"
            onClick={() => navigate(`/plan?readiness=${readiness}`)}
          >
            Use in today’s plan <ArrowRight size={13} />
          </button>
        </div>
      </section>

      {dashboard.tasks.total === 0 ? (
        <EmptyState
          eyebrow="YOUR WORKSPACE IS CLEAR"
          title="Start with one honest commitment."
          body="Capture what has your attention. Your first plan will be generated from the work you add—not from invented activity."
          action={
            <Link className="button button-primary" to="/tasks">
              <ListChecks size={17} /> Open task workspace
            </Link>
          }
        />
      ) : (
        <>
          <section className="dashboard-grid dashboard-top-grid">
            <div className="panel priorities-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">TODAY’S SIGNAL</span>
                  <h2>Three things worth protecting</h2>
                </div>
                <IntelligenceBadge>Decision engine</IntelligenceBadge>
              </div>
              {dashboard.topPriorities.length > 0 ? (
                <div className="priority-list">
                  {dashboard.topPriorities.map((recommendation, index) => (
                    <RecommendationCard
                      key={recommendation.task.id}
                      recommendation={recommendation}
                      rank={index + 1}
                      onStart={() =>
                        navigate(`/focus?task=${recommendation.task.id}`)
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="soft-copy">
                  Everything active is blocked or completed. Capture new work or
                  clear a blocker before generating another plan.
                </p>
              )}
            </div>

            <aside className="next-action-card">
              <div className="next-action-halo" aria-hidden="true">
                <span />
              </div>
              <IntelligenceBadge>Next action</IntelligenceBadge>
              {dashboard.nextAction ? (
                <>
                  <span className="next-action-time">
                    {formatDuration(dashboard.nextAction.task.estimateMinutes)}{" "}
                    focused work
                  </span>
                  <h2>{dashboard.nextAction.task.title}</h2>
                  <p>
                    {dashboard.nextAction.reasons[0]?.message ??
                      "A useful next action is ready when you are."}
                  </p>
                  <button
                    className="button button-light"
                    type="button"
                    onClick={() =>
                      navigate(`/focus?task=${dashboard.nextAction?.task.id}`)
                    }
                  >
                    <Play size={16} fill="currentColor" /> Begin focus
                  </button>
                </>
              ) : (
                <>
                  <h2>Nothing needs forcing.</h2>
                  <p>
                    When you add an active task, FocusAI will explain its place
                    in your day.
                  </p>
                  <Link className="button button-light" to="/tasks">
                    <ListChecks size={16} /> Review tasks
                  </Link>
                </>
              )}
            </aside>
          </section>

          <section className="dashboard-grid dashboard-bottom-grid">
            <article className="panel progress-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <span className="eyebrow">REAL PROGRESS</span>
                  <h2>Today’s task pulse</h2>
                </div>
                <span className="metric-number">{completionRate}%</span>
              </div>
              <div
                className="progress-track"
                aria-label={`${completionRate}% of tasks completed`}
              >
                <span style={{ width: `${completionRate}%` }} />
              </div>
              <div className="progress-caption">
                <span>
                  <CheckCircle2 size={15} /> {dashboard.tasks.completed}{" "}
                  complete
                </span>
                <span>
                  <Circle size={15} /> {dashboard.tasks.active} active
                </span>
              </div>
              <p className="soft-copy">
                This is a count of recorded task status—not a productivity
                score.
              </p>
            </article>

            <article className="panel schedule-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <span className="eyebrow">PLAN SNAPSHOT</span>
                  <h2>
                    {dashboard.plan
                      ? "Your committed blocks"
                      : "Give today a shape"}
                  </h2>
                </div>
                <Link className="text-action" to="/plan">
                  Open studio <ArrowRight size={15} />
                </Link>
              </div>
              {planBlocks.length > 0 ? (
                <div className="mini-timeline">
                  {planBlocks.slice(0, 4).map((block) => (
                    <div className="mini-block" key={block.id}>
                      <span className="mini-block-time">
                        {formatClock(block.startAt)}
                      </span>
                      <span className="mini-block-line" aria-hidden="true" />
                      <div>
                        <strong>{block.title}</strong>
                        <p>{formatDuration(block.durationMinutes)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="inline-empty">
                  <Clock3 size={21} />
                  <p>
                    A schedule only appears after you ask for one. Nothing has
                    been auto-filled.
                  </p>
                  <Link
                    to={`/plan?readiness=${readiness}`}
                    className="text-action"
                  >
                    Generate a realistic plan <ArrowRight size={15} />
                  </Link>
                </div>
              )}
            </article>

            <article className="panel focus-pulse-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <span className="eyebrow">FOCUS STATUS</span>
                  <h2>
                    {dashboard.focusSession
                      ? "A session is in motion"
                      : "Attention is available"}
                  </h2>
                </div>
                <Focus size={20} className="cyan-icon" />
              </div>
              {dashboard.focusSession ? (
                <>
                  <p className="focus-session-title">
                    {dashboard.focusSession.taskTitle ??
                      "Unlinked focus session"}
                  </p>
                  <p className="soft-copy">
                    {dashboard.focusSession.state === "paused"
                      ? "Paused with time safely recorded."
                      : "Time is calculated from timestamps, not a fragile page timer."}
                  </p>
                  <Link className="text-action" to="/focus">
                    Return to focus <ArrowRight size={15} />
                  </Link>
                </>
              ) : (
                <>
                  <p className="soft-copy">
                    Start when you are ready. FocusAI does not create a streak
                    to protect or a penalty to avoid.
                  </p>
                  <Link className="text-action" to="/focus">
                    <Sparkles size={15} /> Enter focus studio
                  </Link>
                </>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}
