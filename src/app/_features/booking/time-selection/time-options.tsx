import { RadioGroup, RadioGroupItem } from "@/app/_components/radio-group";

/** Prop-driven date/slot choices; the screen owns paging and reconciliation. */
export function TimeOptions({
  label,
  idPrefix,
  options,
  value,
  disabled,
  onSelect,
}: {
  label: string;
  idPrefix: "date" | "slot";
  options: readonly { value: string; label: string }[];
  value: string | null;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <RadioGroup
      disabled={disabled}
      aria-label={label}
      value={value}
      className={
        idPrefix === "date"
          ? "grid grid-cols-2 gap-2 sm:grid-cols-4"
          : "grid grid-cols-2 gap-2 sm:grid-cols-3"
      }
      onValueChange={(value) => {
        if (typeof value === "string") onSelect(value);
      }}
    >
      {options.map((option) => (
        <label
          key={option.value}
          htmlFor={`${idPrefix}-${option.value}`}
          className="flex min-h-14 cursor-pointer items-center gap-2 rounded-card border border-border bg-card p-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-data-checked:border-primary has-data-checked:bg-selected"
        >
          <RadioGroupItem
            id={`${idPrefix}-${option.value}`}
            value={option.value}
          />
          <span
            className={
              idPrefix === "date"
                ? "text-sm"
                : "text-sm font-medium whitespace-nowrap tabular-nums"
            }
          >
            {option.label}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
