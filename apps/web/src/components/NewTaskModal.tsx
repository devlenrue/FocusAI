import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Priority } from '@/lib/types';

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewTaskModal({ open, onClose }: NewTaskModalProps) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [estimateMinutes, setEstimateMinutes] = useState(30);
  const [dueAt, setDueAt] = useState('');

  const createTask = useMutation({
    mutationFn: api.createTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
      setTitle('');
      setDescription('');
      setPriority('medium');
      setEstimateMinutes(30);
      setDueAt('');
      onClose();
    },
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !createTask.isPending) onClose();
    }
    if (open) window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createTask.isPending, onClose, open]);

  if (!open) return null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    createTask.mutate({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      estimateMinutes: Math.max(1, Math.round(estimateMinutes)),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !createTask.isPending && onClose()}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">QUICK CAPTURE</span>
            <h2 id="capture-title">Make space in your mind.</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close quick capture" onClick={onClose} disabled={createTask.isPending}>
            <X size={18} />
          </button>
        </header>
        <form className="capture-form" onSubmit={submit}>
          <label htmlFor={titleId}>
            What needs your attention?
            <input
              id={titleId}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Shape the launch brief"
              maxLength={200}
              required
            />
          </label>
          <label htmlFor={descriptionId}>
            Context <span className="field-optional">optional</span>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A note for your future self…"
              maxLength={10_000}
              rows={3}
            />
          </label>
          <div className="form-grid">
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Estimate (minutes)
              <input
                type="number"
                min="1"
                max="720"
                value={estimateMinutes}
                onChange={(event) => setEstimateMinutes(Number(event.target.value))}
              />
            </label>
            <label>
              Due <span className="field-optional">optional</span>
              <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
          </div>
          {createTask.isError && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} />
              {createTask.error.message}
            </p>
          )}
          <footer className="modal-actions">
            <button className="button button-quiet" type="button" onClick={onClose} disabled={createTask.isPending}>
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={!title.trim() || createTask.isPending}>
              <Check size={16} />
              {createTask.isPending ? 'Capturing…' : 'Capture task'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
