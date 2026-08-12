import { useEffect, useRef } from "react";

/**
 * The confirmation in front of an identity resolution. The prototype ships no
 * CSS for it, so it is drawn here from the same tokens as everything else.
 *
 * It is deliberately a step rather than a click: the copy states, before the
 * action, that an audit row naming the moderator and this message is written.
 */

export interface RevealTarget {
  id: string;
  handle: string | null;
  snapshot: string;
  messageId: string;
}

interface RevealDialogProps {
  report: RevealTarget | null;
  onCancel: () => void;
  onConfirm: (report: RevealTarget) => void;
}

const DIALOG =
  "m-auto w-[calc(100%-32px)] max-w-[440px] rounded-[var(--r-card)] border border-line-2 " +
  "bg-panel p-0 text-ink backdrop:bg-black/60";

export function RevealDialog({
  report,
  onCancel,
  onConfirm,
}: RevealDialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (report && !dialog.open) {
      const active = document.activeElement;
      restoreTo.current = active instanceof HTMLElement ? active : null;
      dialog.showModal();
    } else if (!report && dialog.open) {
      dialog.close();
    }
  }, [report]);

  // Escape closes the native dialog without telling React, so the close event is
  // the one place that clears the parent's state and puts focus back.
  function handleClose() {
    const target = restoreTo.current;
    restoreTo.current = null;
    if (target?.isConnected) target.focus();
    onCancel();
  }

  return (
    <dialog
      ref={ref}
      className={DIALOG}
      aria-labelledby="reveal-title"
      onClose={handleClose}
    >
      <div className="px-[22px] pt-[22px]">
        <h2
          id="reveal-title"
          className="text-[16px] font-semibold tracking-[-0.01em]"
        >
          Reveal identity
        </h2>
        <p className="text-ink-2 mt-2 text-[13.5px] leading-[1.55]">
          This resolves a handle to a real V Auth account and writes an audit
          row naming you and the message below.
        </p>
        {report && (
          <div className="border-line-2 bg-panel-2 text-ink-2 mt-3 rounded-[var(--r-ctl)] border p-3 text-[13px] leading-[1.5] [overflow-wrap:anywhere]">
            {`“${report.snapshot}”  — ${report.handle ?? "no handle"}, message ${report.messageId.slice(0, 8)}`}
          </div>
        )}
      </div>
      <div className="mt-[18px] flex justify-end gap-2 px-[22px] pb-[22px]">
        <button
          type="button"
          className="btn h-11"
          onClick={() => ref.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger h-11"
          onClick={() => {
            if (report) onConfirm(report);
          }}
        >
          Reveal
        </button>
      </div>
    </dialog>
  );
}
