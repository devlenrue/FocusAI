import {
  CalendarClock,
  CircleDotDashed,
  LockKeyhole,
  Timer,
} from "lucide-react";
import { formatDuration, dueLabel } from "@/lib/format";
import type { Priority, Task } from "@/lib/types";

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span className={`priority-pill priority-${priority}`}>{priority}</span>
  );
}

export function TaskMeta({
  task,
}: {
  task: Pick<Task, "estimateMinutes" | "dueAt" | "blocked">;
}) {
  const due = dueLabel(task.dueAt);
  return (
    <div className="task-meta">
      <span>
        <Timer size={14} /> {formatDuration(task.estimateMinutes)}
      </span>
      {due && (
        <span className={due.startsWith("Overdue") ? "overdue" : ""}>
          <CalendarClock size={14} /> {due}
        </span>
      )}
      {task.blocked && (
        <span className="blocked">
          <LockKeyhole size={13} /> Blocked
        </span>
      )}
    </div>
  );
}

export function TaskStatusDot({ status }: { status: Task["status"] }) {
  return (
    <span className={`task-status-dot status-${status}`} aria-label={status}>
      <CircleDotDashed size={15} />
    </span>
  );
}
