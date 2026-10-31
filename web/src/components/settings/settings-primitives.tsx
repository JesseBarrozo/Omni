// Settings pane primitives, modelled on Orca's SettingsFormControls: a section
// card, a subsection header (title + description + optional action), and a row
// (label and description on the left, a control on the right). Presentational
// only; the panel wires the controls and data.

import { useId } from "react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// A segmented pill selector, like Orca's SettingsSegmentedControl: one option is
// active. Each option may carry a leading icon (e.g. an agent logo).
export function SettingsSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("settings-segmented", className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          data-active={option.value === value ? "true" : undefined}
          className="settings-segment"
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span className="settings-segment-icon">{option.icon}</span>}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("settings-section", className)}>
      {(title || description || action) && (
        <SettingsSubsectionHeader title={title} description={description} action={action} />
      )}
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function SettingsSubsectionHeader({
  title,
  description,
  action,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="settings-subsection-header">
      <div className="settings-subsection-text">
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
      </div>
      {action && <div className="settings-subsection-action">{action}</div>}
    </div>
  );
}

// A labelled row. When `control` is interactive, pass it so the label points at
// it; otherwise the row is a plain label/description over an action.
export function SettingsRow({
  label,
  description,
  control,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div className={cn("settings-field-row", className)}>
      <div className="settings-field-text">
        <Label id={labelId} className="select-text">
          {label}
        </Label>
        {description && <p className="settings-field-description">{description}</p>}
      </div>
      <div className="settings-field-control">{control}</div>
    </div>
  );
}
