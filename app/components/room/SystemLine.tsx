import type { SystemTone } from "../../../workers/protocol";
import { cn } from "~/lib/utils";

export interface SystemLineProps {
  tone?: SystemTone;
  text: string;
}

/** A join, warn or dead line in the log. Never a message, never reportable. */
export function SystemLine({ tone, text }: SystemLineProps) {
  return (
    <div className={cn("sys", tone ? `sys-${tone}` : undefined)}>{text}</div>
  );
}
