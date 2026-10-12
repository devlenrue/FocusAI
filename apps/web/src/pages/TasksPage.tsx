import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronRight,
  CirclePlus,
  Clock,
  Filter,
  Focus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { Task } from "@/lib/types";
import { NewTaskModal } from "@/components/NewTaskModal";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import {
  PriorityPill,
  TaskMeta,
  TaskStatusDot,
} from "@/components/TaskVisuals";

type ViewFilter = "all" | "active" | "done";

const EMPTY_TASKS: Task[] = [];

function TaskItem({
  task,
  onComplete,
  onDelete,
  isCompleting,
  isDeleting,
}: {
  task: Task;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
  isCompleting: boolean;
  isDeleting: boolean;
}) {
  const navigate = useNavigate();
  const isDone = task.status === "done";
  return (
    <article className={`task-row ${isDone ? "task-row-done" : ""}`}>
      <button
        className={`complete-toggle ${isDone ? "completed" : ""}`}
        type="button"
        aria-label={
          isDone ? `${task.title} is complete` : `Mark ${task.title} complete`
        }
        disabled={isDone || isCompleting}
        onClick={() => onComplete(task)}
      >
        <Check size={15} strokeWidth={3} />
      </button>
      <div className="task-row-body">
        <div className="task-row-heading">
          <TaskStatusDot status={task.status} />
          <h3>{task.title}</h3>
          <PriorityPill priority={task.priority} />
        </div>
        {task.description && (
          <p className="task-description">{task.description}</p>
        )}
        <TaskMeta task={task} />
      </div>
      <div className="task-row-actions">
        {!isDone && (
          <button
            className="icon-button icon-button-labeled"
            type="button"
            onClick={() => navigate(`/focus?task=${task.id}`)}
            aria-label={`Focus on ${task.title}`}
          >
            <Focus size={16} />
            <span>Focus</span>
          </button>
        )}
        <button
          className="icon-button destructive-button"
          type="button"
          onClick={() => onDelete(task)}
          disabled={isDeleting}
          aria-label={`Delete ${task.title}`}
        >
          <Trash2 size={16} />
        </button>
        <ChevronRight className="task-chevron" size={18} aria-hidden="true" />
      </div>
    </article>
  );
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [isCaptureOpen, setCaptureOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks", { search }],
    queryFn: () => api.getTasks({ q: search || undefined }),
  });
  const completeTask = useMutation({
    mutationFn: ({
      taskId,
      actualMinutes,
    }: {
      taskId: string;
      actualMinutes: number;
    }) => api.completeTask(taskId, actualMinutes),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
      ]);
    },
    onError: (error: Error) => setActionError(error.message),
  });
  const deleteTask = useMutation({
    mutationFn: api.deleteTask,
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["plan"] }),
      ]);
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const allTasks = tasksQuery.data?.items ?? EMPTY_TASKS;
  const visibleTasks = useMemo(() => {
    if (view === "active")
      return allTasks.filter((task) => task.status !== "done");
    if (view === "done")
      return allTasks.filter((task) => task.status === "done");
    return allTasks;
  }, [allTasks, view]);

  function complete(task: Task) {
    completeTask.mutate({
      taskId: task.id,
      actualMinutes: task.actualMinutes || task.estimateMinutes,
    });
  }

  function remove(task: Task) {
    const approved = window.confirm(
      `Delete “${task.title}”? This cannot be undone.`,
    );
    if (approved) deleteTask.mutate(task.id);
  }

  return (
    <div className="tasks-page page-stack">
      <section className="workspace-header">
        <div>
          <span className="eyebrow">TASK WORKSPACE</span>
          <h1>
            Keep the work visible.
            <br />
            <span>Keep the noise out.</span>
          </h1>
          <p>
            Every item here is persisted locally and is available to the daily
            planning engine.
          </p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={() => setCaptureOpen(true)}
        >
          <CirclePlus size={17} /> Capture task
        </button>
      </section>

      <section className="task-toolbar panel" aria-label="Task filters">
        <label className="search-control">
          <Search size={17} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your actual tasks"
            aria-label="Search tasks"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <div className="view-tabs" role="group" aria-label="Task view">
          <Filter size={15} aria-hidden="true" />
          {(["all", "active", "done"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={view === option ? "active" : ""}
              onClick={() => setView(option)}
            >
              {option === "all"
                ? "All"
                : option === "active"
                  ? "Active"
                  : "Completed"}
            </button>
          ))}
        </div>
      </section>

      {actionError && (
        <div className="inline-notice error-notice" role="alert">
          {actionError}
        </div>
      )}
      {tasksQuery.isPending ? (
        <LoadingState label="Opening your task workspace…" />
      ) : tasksQuery.isError ? (
        <ErrorState
          message={tasksQuery.error.message}
          onRetry={() => tasksQuery.refetch()}
        />
      ) : allTasks.length === 0 ? (
        <EmptyState
          eyebrow="NOTHING CAPTURED YET"
          title="What is taking up space in your head?"
          body="Add one task with a realistic estimate. The decision engine will have something real to work with."
          action={
            <button
              className="button button-primary"
              type="button"
              onClick={() => setCaptureOpen(true)}
            >
              <CirclePlus size={17} /> Capture first task
            </button>
          }
        />
      ) : visibleTasks.length === 0 ? (
        <EmptyState
          eyebrow="NO MATCHES"
          title="This view is intentionally clear."
          body={
            view === "done"
              ? "Completed work will appear here once you mark it done."
              : "Try a different filter or clear your search to see your captured work."
          }
          action={
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                setView("all");
                setSearch("");
              }}
            >
              Reset filters
            </button>
          }
        />
      ) : (
        <section className="task-list panel" aria-label="Tasks">
          <header className="task-list-header">
            <div>
              <span className="eyebrow">
                {view === "active"
                  ? "ACTIVE WORK"
                  : view === "done"
                    ? "COMPLETED WORK"
                    : "ALL WORK"}
              </span>
              <h2>
                {visibleTasks.length}{" "}
                {visibleTasks.length === 1 ? "item" : "items"} in view
              </h2>
            </div>
            <span className="list-capacity">
              <Clock size={15} />{" "}
              {formatDuration(
                visibleTasks
                  .filter((task) => task.status !== "done")
                  .reduce((total, task) => total + task.estimateMinutes, 0),
              )}{" "}
              remaining
            </span>
          </header>
          <div className="task-list-content">
            {visibleTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onComplete={complete}
                onDelete={remove}
                isCompleting={
                  completeTask.isPending &&
                  completeTask.variables?.taskId === task.id
                }
                isDeleting={
                  deleteTask.isPending && deleteTask.variables === task.id
                }
              />
            ))}
          </div>
          <footer className="task-list-footer">
            <span>
              Completion records the task’s estimated duration until detailed
              effort tracking is added.
            </span>
            <Link to="/plan">
              Turn active work into a plan <ChevronRight size={15} />
            </Link>
          </footer>
        </section>
      )}
      <NewTaskModal
        open={isCaptureOpen}
        onClose={() => setCaptureOpen(false)}
      />
    </div>
  );
}
