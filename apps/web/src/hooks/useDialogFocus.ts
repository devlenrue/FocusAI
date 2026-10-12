import { useLayoutEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => element.getClientRects().length > 0);
}

interface UseDialogFocusOptions {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  dismissDisabled?: boolean;
}

/**
 * Keeps keyboard focus inside a modal dialog and returns focus to its trigger
 * when the dialog closes. The dialog supplies its first control with
 * data-dialog-initial-focus so opening focus is explicit rather than implicit.
 */
export function useDialogFocus({
  open,
  dialogRef,
  onDismiss,
  dismissDisabled = false,
}: UseDialogFocusOptions) {
  const onDismissRef = useRef(onDismiss);
  const dismissDisabledRef = useRef(dismissDisabled);
  onDismissRef.current = onDismiss;
  dismissDisabledRef.current = dismissDisabled;

  useLayoutEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initialFocus =
      activeDialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      focusableElements(activeDialog)[0] ??
      activeDialog;
    initialFocus.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!dismissDisabledRef.current) {
          event.preventDefault();
          onDismissRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = focusableElements(activeDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const activeIndex = activeElement ? focusable.indexOf(activeElement) : -1;

      if (event.shiftKey && (activeElement === first || activeIndex === -1)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === last || activeIndex === -1)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [dialogRef, open]);
}
