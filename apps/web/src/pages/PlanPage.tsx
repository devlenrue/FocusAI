import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  CircleAlert,
  Clock3,
  Compass,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  formatClock,
  formatDate,
  formatDuration,
  todayKey,
} from "@/lib/format";
import type { Plan, Readiness } from "@/lib/types";
import { IntelligenceBadge } from "@/components/FocusMark";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { PriorityPill } from "@/components/TaskVisuals";

const readinessOptions: Array<{
  value: Readiness;
  title: string;
  description: string;
}> = [
  { value: "low", title: "Low", description: "Favor lighter, clearer starts" },
  { value: "steady", title: "Steady", description: "Use a balanced sequence" },
  { value: "high", title: "High", description: "Make room for deeper work" },
];

function Timeline({ plan, timeZone }: { plan: Plan; timeZone?: string }) {
  if (plan.blocks.length === 0) {
    return (
      <div className="inline-empty plan-inline-empty">
        <Clock3 size={22} />
        <div>
          <strong>No block was forced into this day.</strong>
          <p>
            There may be no active tasks, or nothing fits the available capacity
            yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ol className="plan-timeline">
      {plan.blocks.map((block, index) => (
        <li key={block.id} className="plan-block">
          <div className="plan-time">
            <strong>{formatClock(block.startAt, timeZone)}</strong>
            <span>{formatDuration(block.durationMinutes)}</span>
          </div>
          <span className="timeline-node" aria-hidden="true">
            <i />
          </span>
          <article>
            <span className="block-sequence">
              BLOCK {String(index + 1).padStart(2, "0")}
            </span>
            <h3>{block.title}</h3>
            <p>
              Reserved from {formatClock(block.startAt, timeZone)} to{" "}
              {formatClock(block.endAt, timeZone)} · scored{" "}
              {Math.round(block.score * 100)}%
            </p>
          </article>
        </li>
      ))}
    </ol>
  );
}

export function PlanPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [planDate, setPlanDate] = useState(
    () => searchParams.get("date") ?? "",
  );
  const initialReadiness = searchParams.get("readiness");
  const [readiness, setReadiness] = useState<Readiness>(
    initialReadiness === "low" || initialReadiness === "high"
      ? initialReadiness
      : "steady",
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: api.getPreferences,
  });
  const timeZone = preferencesQuery.data?.timezone;

  useEffect(() => {
    if (!planDate && timeZone) setPlanDate(todayKey(timeZone));
  }, [planDate, timeZone]);

  useEffect(() => {
    if (!planDate) return;
    setSearchParams(
      (current) => {
        current.set("date", planDate);
        current.set("readiness", readiness);
        return current;
      },
      { replace: true },
    );
  }, [planDate, readiness, setSearchParams]);

  const planQuery = useQuery({
    queryKey: ["plan", planDate],
    queryFn: () => api.getPlan(planDate),
    enabled: Boolean(planDate),
  });
  const generatePlan = useMutation({
    mutationFn: ({ recovery }: { recovery?: boolean }) =>
      api.generatePlan({
        planDate,
        readiness,
        recovery,
        now: new Date().toISOString(),
      }),
    onSuccess: async (plan) => {
      setActionMessage(
        plan.type === "recovery"
          ? "The remaining day was recalculated from the current timestamp. Review it before committing."
          : "A fresh draft is ready. Nothing changes until you approve it.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const acceptPlan = useMutation({
    mutationFn: api.acceptPlan,
    onSuccess: async () => {
      setActionMessage(
        "Plan approved. You can still regenerate it when reality changes.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  const plan = planQuery.data?.plan;
  const isBusy = generatePlan.isPending || acceptPlan.isPending;
  const error = generatePlan.error ?? acceptPlan.error;

  return (
    <div className="plan-page page-stack">
      <section className="plan-hero">
        <div>
          <span className="eyebrow">AI PLANNING STUDIO</span>
          <h1>
            Make a day that can
            <br />
            <span>survive real life.</span>
          </h1>
          <p>
            FocusAI’s deterministic core protects calendar constraints,
            estimates, dependencies, and capacity before an explanation is ever
            generated.
          </p>
        </div>
        <div className="plan-hero-signature" aria-hidden="true">
          <span className="signature-orbit orbit-one" />
          <span className="signature-orbit orbit-two" />
          <span className="signature-core">
            <Sparkles size={22} />
          </span>
        </div>
      </section>

      <section className="planning-console panel">
        <div className="planning-console-heading">
          <div>
            <span className="eyebrow">PLAN INPUTS</span>
            <h2>Choose the conditions that are true.</h2>
          </div>
          <IntelligenceBadge>Feasibility first</IntelligenceBadge>
        </div>
        <div className="planning-controls">
          <label className="date-control">
            <span>Planning date</span>
            <input
              type="date"
              value={planDate}
              onChange={(event) => setPlanDate(event.target.value)}
            />
          </label>
          <fieldset className="readiness-fieldset">
            <legend>Current readiness</legend>
            <div className="readiness-options">
              {readinessOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={readiness === option.value ? "active" : ""}
                  aria-pressed={readiness === option.value}
                  onClick={() => setReadiness(option.value)}
                >
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="planning-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={isBusy || !planDate}
              onClick={() => generatePlan.mutate({})}
            >
              <WandSparkles size={17} />
              {generatePlan.isPending
                ? "Evaluating…"
                : plan
                  ? "Regenerate plan"
                  : "Generate plan"}
            </button>
            {plan && (
              <button
                className="button button-quiet"
                type="button"
                disabled={isBusy}
                onClick={() => generatePlan.mutate({ recovery: true })}
              >
                <RefreshCw size={16} /> Recalculate remaining day
              </button>
            )}
          </div>
        </div>
        <p className="planning-disclosure">
          <ShieldCheck size={15} /> Plans use your {timeZone ?? "configured"}{" "}
          time zone, saved working window, and fixed commitments. Need to change
          them? <Link to="/schedule">Manage schedule & capacity</Link>.
        </p>
      </section>

      {actionMessage && (
        <div className="inline-notice success-notice" role="status">
          <Check size={16} /> {actionMessage}
        </div>
      )}
      {error && (
        <div className="inline-notice error-notice" role="alert">
          <AlertCircle size={16} /> {error.message}
        </div>
      )}

      {planQuery.isPending ? (
        <LoadingState label="Looking for an existing plan…" />
      ) : planQuery.isError ? (
        <ErrorState
          message={planQuery.error.message}
          onRetry={() => planQuery.refetch()}
        />
      ) : !plan ? (
        <EmptyState
          eyebrow="NO PLAN YET"
          title="A plan should be proposed, not assumed."
          body="Set your readiness and generate a draft. The studio will say clearly when the work does not fit."
          action={
            <button
              className="button button-primary"
              type="button"
              disabled={isBusy}
              onClick={() => generatePlan.mutate({})}
            >
              <WandSparkles size={17} /> Generate a draft
            </button>
          }
        />
      ) : (
        <section className="plan-output-grid">
          <article className="panel schedule-workspace">
            <header className="schedule-workspace-header">
              <div>
                <span className="eyebrow">
                  {plan.type === "recovery"
                    ? "RECOVERY DRAFT"
                    : plan.status === "accepted"
                      ? "APPROVED PLAN"
                      : "SCHEDULE DRAFT"}
                </span>
                <h2>{formatDate(plan.planDate)}</h2>
              </div>
              <div className="plan-status-wrap">
                <span className={`plan-status status-${plan.status}`}>
                  {plan.status === "accepted" ? "Approved" : "Review needed"}
                </span>
                {plan.status !== "accepted" && (
                  <button
                    className="button button-primary button-small"
                    type="button"
                    disabled={isBusy}
                    onClick={() => acceptPlan.mutate(plan.id)}
                  >
                    <Check size={15} /> Approve plan
                  </button>
                )}
              </div>
            </header>
            {plan.type === "recovery" && plan.recovery && (
              <div className="recovery-message">
                <Compass size={18} />
                <div>
                  <strong>Recovery, without the guilt.</strong>
                  <p>
                    {plan.recovery.message}{" "}
                    {plan.recovery.highCognitiveScheduledMinutes} of{" "}
                    {plan.recovery.highCognitiveCapMinutes} protected
                    high-cognitive minutes are scheduled.
                  </p>
                </div>
              </div>
            )}
            <Timeline plan={plan} timeZone={timeZone} />
          </article>

          <aside className="plan-insights-stack">
            <article className="panel plan-capacity-card">
              <span className="eyebrow">CAPACITY CHECK</span>
              <div className="capacity-number">
                <strong>{formatDuration(plan.scheduledMinutes)}</strong>
                <span>of {formatDuration(plan.capacityMinutes)} available</span>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, (plan.scheduledMinutes / Math.max(1, plan.capacityMinutes)) * 100)}%`,
                  }}
                />
              </div>
              <p>
                {plan.feasibility.isFeasible
                  ? "All currently eligible tasks fit without overlap."
                  : `${plan.deferred.length} task${plan.deferred.length === 1 ? "" : "s"} need a deliberate decision.`}
              </p>
            </article>
            <article className="panel plan-priorities-card">
              <div className="panel-heading compact-heading">
                <div>
                  <span className="eyebrow">WHY THIS ORDER</span>
                  <h2>Priority signals</h2>
                </div>
                <Lightbulb size={19} className="violet-icon" />
              </div>
              {plan.topPriorities.length ? (
                <ol className="recommendation-mini-list">
                  {plan.topPriorities.map((item, index) => (
                    <li key={item.task.id}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{item.task.title}</strong>
                        <p>
                          {item.reasons[0]?.message ??
                            "A real task in this plan."}
                        </p>
                      </div>
                      <PriorityPill priority={item.task.priority} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="soft-copy">
                  No active, unblocked tasks were available to rank.
                </p>
              )}
            </article>
            {plan.deferred.length > 0 && (
              <article className="panel deferred-card">
                <div className="panel-heading compact-heading">
                  <div>
                    <span className="eyebrow">NOT FORCED IN</span>
                    <h2>Needs a decision</h2>
                  </div>
                  <CircleAlert size={19} className="amber-icon" />
                </div>
                <ul>
                  {plan.deferred.map((task) => (
                    <li key={`${task.taskId}-${task.reason}`}>
                      <strong>{task.title}</strong>
                      <span>{task.detail}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </aside>
        </section>
      )}
    </div>
  );
}
