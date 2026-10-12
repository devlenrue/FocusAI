import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  CircleStop,
  Clock3,
  Coffee,
  Focus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatTimer } from "@/lib/format";
import type { FocusSession } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/States";

function sessionElapsedSeconds(session: FocusSession, now: number): number {
  if (session.state !== "active") return session.accumulatedSeconds;
  return (
    session.accumulatedSeconds +
    Math.max(0, Math.floor((now - Date.parse(session.stateChangedAt)) / 1000))
  );
}

function FocusTimer({ session }: { session: FocusSession }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (session.state !== "active") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session.state, session.stateChangedAt]);

  const elapsed = sessionElapsedSeconds(session, now);
  const target = session.plannedMinutes * 60;
  const remaining = Math.max(0, target - elapsed);
  const progress = Math.min(100, (elapsed / Math.max(1, target)) * 100);
  const ringStyle = {
    background: `conic-gradient(var(--cyan) ${progress}%, rgba(140, 167, 200, 0.13) ${progress}% 100%)`,
  };

  return (
    <div className="focus-timer-wrap">
      <div
        className="focus-ring"
        style={ringStyle}
        aria-label={`${formatTimer(remaining)} remaining`}
      >
        <div className="focus-ring-inner">
          <span className="timer-overline">
            {session.state === "active" ? "FOCUSING" : "PAUSED"}
          </span>
          <strong className="timer-digits" aria-live="polite">
            {formatTimer(remaining)}
          </strong>
          <span className="timer-caption">{formatTimer(elapsed)} recorded</span>
        </div>
      </div>
      <p className="timer-disclosure">
        The display redraws every second; the recorded duration comes from
        persisted timestamps.
      </p>
    </div>
  );
}

export function FocusPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedTaskId = searchParams.get("task");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(
    requestedTaskId ?? "",
  );
  const [duration, setDuration] = useState(25);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const taskQuery = useQuery({
    queryKey: ["tasks", "focus-select"],
    queryFn: () => api.getTasks(),
  });
  const activeQuery = useQuery({
    queryKey: ["focus", "active"],
    queryFn: api.getActiveFocus,
    refetchInterval: 30_000,
  });
  const historyQuery = useQuery({
    queryKey: ["focus", "history"],
    queryFn: api.getFocusSessions,
  });
  const activeSession = activeQuery.data?.session ?? null;

  useEffect(() => {
    if (requestedTaskId && !activeSession) setSelectedTaskId(requestedTaskId);
  }, [activeSession, requestedTaskId]);

  const invalidateFocus = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["focus"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  const startSession = useMutation({
    mutationFn: api.startFocus,
    onSuccess: async () => {
      setMessage(
        "Focus session started. Your elapsed time will survive a page reload.",
      );
      setNote("");
      await invalidateFocus();
    },
  });
  const transitionSession = useMutation({
    mutationFn: ({
      sessionId,
      action,
    }: {
      sessionId: string;
      action: "pause" | "resume" | "complete" | "stop";
    }) => api.transitionFocus(sessionId, action),
    onSuccess: async (_, variables) => {
      setMessage(
        variables.action === "complete"
          ? "Session recorded. Complete the linked task separately only if the work itself is finished."
          : variables.action === "stop"
            ? "Session stopped. The time already recorded remains part of your history."
            : variables.action === "pause"
              ? "Paused. Nothing is lost."
              : "Focus resumed.",
      );
      await invalidateFocus();
    },
  });

  const availableTasks = useMemo(
    () => taskQuery.data?.items.filter((task) => task.status !== "done") ?? [],
    [taskQuery.data],
  );
  const selectedTask = availableTasks.find(
    (task) => task.id === selectedTaskId,
  );
  const history = historyQuery.data?.items ?? [];
  const error = startSession.error ?? transitionSession.error;

  function start() {
    startSession.mutate({
      taskId: selectedTaskId || null,
      plannedMinutes: duration,
      note: note.trim() || null,
    });
  }

  const isLoading = taskQuery.isPending || activeQuery.isPending;
  if (isLoading)
    return <LoadingState label="Preparing a quiet place to focus…" />;
  if (taskQuery.isError || activeQuery.isError) {
    const errorMessage =
      taskQuery.error?.message ??
      activeQuery.error?.message ??
      "Unknown connection error.";
    return (
      <ErrorState
        message={errorMessage}
        onRetry={() => {
          void taskQuery.refetch();
          void activeQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="focus-page page-stack">
      <section className="focus-header">
        <div>
          <span className="eyebrow">FOCUS STUDIO</span>
          <h1>
            One thing.
            <br />
            <span>One honest interval.</span>
          </h1>
          <p>
            A calm place to make progress. Pauses, early stops, and reloads are
            recorded without rewriting what happened.
          </p>
        </div>
        <div className="focus-header-badge">
          <Focus size={19} />
          <span>Timestamp-safe timer</span>
        </div>
      </section>

      {message && (
        <div className="inline-notice success-notice" role="status">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="inline-notice error-notice" role="alert">
          <CircleStop size={16} /> {error.message}
        </div>
      )}

      <section
        className={`focus-stage ${activeSession ? "focus-stage-active" : ""}`}
      >
        <div className="focus-atmosphere" aria-hidden="true" />
        {activeSession ? (
          <>
            <div className="focus-stage-copy">
              <span className="eyebrow">
                {activeSession.state === "active"
                  ? "SESSION IN PROGRESS"
                  : "SESSION HELD"}
              </span>
              <h2>{activeSession.taskTitle ?? "Unlinked focus interval"}</h2>
              <p>
                {activeSession.note ||
                  "Stay with the work in front of you. The next decision can wait."}
              </p>
              <div className="focus-control-row">
                {activeSession.state === "active" ? (
                  <button
                    className="button button-light"
                    type="button"
                    disabled={transitionSession.isPending}
                    onClick={() =>
                      transitionSession.mutate({
                        sessionId: activeSession.id,
                        action: "pause",
                      })
                    }
                  >
                    <Pause size={17} fill="currentColor" /> Pause
                  </button>
                ) : (
                  <button
                    className="button button-light"
                    type="button"
                    disabled={transitionSession.isPending}
                    onClick={() =>
                      transitionSession.mutate({
                        sessionId: activeSession.id,
                        action: "resume",
                      })
                    }
                  >
                    <Play size={17} fill="currentColor" /> Resume
                  </button>
                )}
                <button
                  className="button button-outline-light"
                  type="button"
                  disabled={transitionSession.isPending}
                  onClick={() =>
                    transitionSession.mutate({
                      sessionId: activeSession.id,
                      action: "complete",
                    })
                  }
                >
                  <CheckCircle2 size={17} /> Record complete
                </button>
                <button
                  className="button button-ghost-light"
                  type="button"
                  disabled={transitionSession.isPending}
                  onClick={() =>
                    transitionSession.mutate({
                      sessionId: activeSession.id,
                      action: "stop",
                    })
                  }
                >
                  End early
                </button>
              </div>
            </div>
            <FocusTimer session={activeSession} />
          </>
        ) : (
          <>
            <div className="focus-stage-copy">
              <span className="eyebrow">READY WHEN YOU ARE</span>
              <h2>
                {selectedTask
                  ? selectedTask.title
                  : "Choose a task, or simply make room."}
              </h2>
              <p>
                {selectedTask
                  ? `${selectedTask.estimateMinutes} minutes estimated. Set an interval that helps you begin, not one that proves anything.`
                  : "Linking a task is optional, but it gives your session useful context."}
              </p>
              <div className="focus-start-summary">
                <Clock3 size={16} /> <span>{duration} minute interval</span>
                <span className="dot-separator">•</span>
                <span>
                  {selectedTask ? "Linked to a real task" : "Unlinked session"}
                </span>
              </div>
            </div>
            <div className="idle-focus-core" aria-hidden="true">
              <span />
              <i />
              <b />
            </div>
          </>
        )}
      </section>

      {!activeSession && (
        <section className="focus-setup panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SESSION SETUP</span>
              <h2>Set an interval with intention.</h2>
            </div>
            <Sparkles size={19} className="cyan-icon" />
          </div>
          <div className="focus-setup-grid">
            <label>
              Linked task <span className="field-optional">optional</span>
              <select
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                <option value="">No linked task</option>
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} · {task.estimateMinutes}m
                  </option>
                ))}
              </select>
            </label>
            <label>
              Focus minutes
              <input
                type="number"
                min="1"
                max="240"
                value={duration}
                onChange={(event) =>
                  setDuration(
                    Math.max(1, Math.min(240, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <label className="focus-note-label">
              A small intention <span className="field-optional">optional</span>
              <input
                value={note}
                maxLength={2_000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. Draft the opening, not the whole document"
              />
            </label>
            <button
              className="button button-primary focus-start-button"
              type="button"
              onClick={start}
              disabled={startSession.isPending}
            >
              <Play size={17} fill="currentColor" />{" "}
              {startSession.isPending ? "Starting…" : "Start focus"}
            </button>
          </div>
          {availableTasks.length === 0 && (
            <p className="planning-disclosure">
              <Coffee size={15} /> There are no active tasks to link. You can
              still begin an unlinked session, or{" "}
              <Link to="/tasks">capture a task first</Link>.
            </p>
          )}
        </section>
      )}

      <section className="focus-history panel">
        <div className="panel-heading compact-heading">
          <div>
            <span className="eyebrow">SESSION HISTORY</span>
            <h2>What was actually recorded</h2>
          </div>
          <TimerReset size={19} className="violet-icon" />
        </div>
        {historyQuery.isPending ? (
          <LoadingState label="Loading session history…" />
        ) : history.length === 0 ? (
          <div className="inline-empty">
            <RotateCcw size={21} />
            <p>
              No focus session is recorded yet. Your history begins when you
              choose to start.
            </p>
          </div>
        ) : (
          <div className="session-history-list">
            {history.slice(0, 5).map((session) => (
              <div key={session.id} className="session-history-row">
                <span className={`session-state state-${session.state}`} />
                <div>
                  <strong>{session.taskTitle ?? "Unlinked focus"}</strong>
                  <p>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(session.startedAt))}
                  </p>
                </div>
                <span>{formatTimer(session.accumulatedSeconds)}</span>
                <small>{session.state}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
