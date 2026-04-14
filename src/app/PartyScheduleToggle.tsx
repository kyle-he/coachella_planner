"use client";

/** Accessible on/off control for whether a party appears on the schedule. */
export function PartyScheduleToggle({
  label,
  checked,
  disabled,
  onChange,
  id,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        id={id}
        aria-labelledby={`${id}-label`}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 ${
          checked
            ? "bg-accent"
            : "bg-[var(--hover-wash-strong)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_40%,transparent)]"
        } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
