// Locally owned component foundation (shadcn-style, not a runtime theme).
// Thin, readable wrappers over Radix behavior primitives plus Tailwind
// utilities drawn only from the measured @theme tokens. Screens never touch
// Radix or raw Tailwind directly; they compose these variants. No Tailwind
// default palette, radius, shadow, or type scale leaks into chrome — every
// class below references a theme token or a structural utility.

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "icon";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold " +
  "transition-colors focus-visible:outline-focus min-h-[36px] disabled:cursor-not-allowed disabled:opacity-55 " +
  "[&:disabled]:opacity-55";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Flat fills from measured tokens; no gradients, no glow.
  primary: "border-accent bg-accent text-white hover:bg-seq1",
  secondary: "border-line bg-surface text-ink hover:border-accent",
  ghost: "border-transparent bg-transparent text-ink hover:border-line hover:bg-raised",
  destructive: "border-error bg-surface text-error hover:bg-error hover:text-white",
  icon: "border-line bg-surface text-ink hover:border-accent p-2 min-h-[36px] min-w-[36px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", active = false): string {
  const on = active ? " border-accent bg-accent text-white" : "";
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}${on}`;
}

export function Button({
  variant = "secondary",
  active = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  active?: boolean;
}) {
  return <button type="button" className={`${buttonClass(variant, active)} ${className}`} {...props} />;
}

/** Tooltip: pointer-only enhancement. Keyboard/touch disclosure always has a
 *  separate, focusable path (see DisabledReason); never tooltip-alone. */
export function ChromeTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="muse-tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Disabled-reason disclosure (MF-3): the control stays truly disabled, and a
 * focusable wrapper carries the reason into the accessibility tree
 * (aria-label + aria-describedby to a real node) for keyboard users, shows
 * the tooltip on hover/focus for pointer users, and toggles the tooltip on
 * tap for touch users (focus lands on tap). Tooltips never stand alone.
 */
export function DisabledReason({
  reason,
  reasonId,
  children,
}: {
  reason: string;
  reasonId: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        <span
          tabIndex={0}
          role="note"
          aria-label={reason}
          aria-describedby={reasonId}
          data-testid={`${reasonId}-disclosure`}
          className="inline-flex rounded-md focus-visible:outline-focus"
        >
          <span id={reasonId} className="sr-only">
            {reason}
          </span>
          {children}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="muse-tooltip" sideOffset={6}>
          <span id={reasonId}>{reason}</span>
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Popover surface: opaque card, calm elevation, no glass. */
export function ChromePopover({
  trigger,
  label,
  children,
  testId,
  side = "bottom",
  align = "start",
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  testId: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="muse-popover w-[320px] max-w-[calc(100vw-24px)]"
          side={side}
          align={align}
          sideOffset={8}
          aria-label={label}
          data-testid={testId}
        >
          {children}
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Dialog/sheet surface: modal overlay + opaque panel. Sheet styling for
 *  bottom sheets comes from the caller through panelClassName. */
export function ChromeDialog({
  trigger,
  title,
  description,
  children,
  testId,
  open,
  onOpenChange,
  panelClassName = "muse-dialog",
}: {
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  testId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelClassName?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="muse-dialog-overlay" />
        <Dialog.Content className={panelClassName} aria-label={title} data-testid={testId}>
          <Dialog.Title className="m-0 text-base font-semibold text-ink">{title}</Dialog.Title>
          {description !== undefined && (
            <Dialog.Description className="mt-1 text-xs text-muted">{description}</Dialog.Description>
          )}
          <div className="mt-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Status badge: compact package/selection signal with dot + text (never
 *  color-alone). */
export function StatusBadge({ tone, children, testId }: { tone: "idle" | "ready" | "warn"; children: ReactNode; testId: string }) {
  const dot = tone === "ready" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-muted";
  return (
    <p
      data-testid={testId}
      role="status"
      title={typeof children === "string" ? children : undefined}
      className="m-0 flex max-w-[44ch] items-center gap-2 overflow-hidden text-xs text-white"
    >
      <span className={`inline-block h-2 w-2 flex-none rounded-full ${dot}`} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </p>
  );
}

/** Notice: single dismissible limitation/status strip; rail lists the rest. */
export function Notice({
  tone = "warn",
  title,
  children,
  onDismiss,
  dismissTestId,
  dismissLabel,
  testId,
}: {
  tone?: "warn" | "error" | "info";
  title: string;
  children: ReactNode;
  onDismiss?: () => void;
  dismissTestId?: string;
  dismissLabel?: string;
  testId?: string;
}) {
  const tones = {
    warn: "border-warn bg-warnbg text-warn",
    error: "border-error bg-surface text-error",
    info: "border-line bg-raised text-ink",
  } as const;
  return (
    <div
      data-testid={testId}
      role="status"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${tones[tone]}`}
    >
      <p className="m-0 flex-1">
        <strong>{title}: </strong>
        {children}
      </p>
      {onDismiss !== undefined && (
        <button
          type="button"
          data-testid={dismissTestId}
          aria-label={dismissLabel ?? `Dismiss ${title}`}
          title={dismissLabel ?? `Dismiss ${title}`}
          onClick={onDismiss}
          className="rounded-sm border border-current px-2 py-0.5 text-xs font-semibold"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Layer/legend row: swatch or dashed line sample + label + reference tag. */
export function LayerRow({
  checked,
  onChange,
  swatch,
  label,
  detail,
  count,
  testId,
  referenceTag,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  swatch: ReactNode;
  label: string;
  detail?: string;
  count?: number;
  testId: string;
  referenceTag?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="my-2 flex cursor-pointer items-center gap-2 text-sm text-ink" title={title}>
      <input type="checkbox" data-testid={testId} checked={checked} onChange={onChange} disabled={disabled} title={title} />
      {swatch}
      <span className="min-w-0 flex-1">
        {label}
        {detail !== undefined && <span className="text-muted"> · {detail}</span>}
        {count !== undefined && <span className="text-muted"> ({count})</span>}
      </span>
      {referenceTag !== undefined && <span className="ref-tag">{referenceTag}</span>}
    </label>
  );
}

/** Empty/error state: one line, never a large blank region. */
export function EmptyState({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="m-0 py-1 text-xs text-muted">
      {children}
    </p>
  );
}

/** Mount/layout transition wrapper. Collapses under prefers-reduced-motion
 *  through the app-level MotionConfig (Gate 1); camera travel stays on
 *  cameraDuration() (Gate 2). */
export function MountMotion({
  id,
  children,
  direction = "up",
}: {
  id: string;
  children: ReactNode;
  direction?: "up" | "right";
}) {
  const offset = direction === "up" ? { y: 12, x: 0 } : { y: 0, x: 12 };
  return (
    <AnimatePresence>
      <motion.div
        key={id}
        initial={{ opacity: 0, ...offset }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, ...offset }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
