import { Avatar, AvatarFallback } from "@/app/_components/avatar";
import { RadioGroupItem } from "@/app/_components/radio-group";
import type { Staff } from "@/app/_lib/booking/types";

export function SpecialistOption({
  member,
  services,
  selected,
  reason,
}: {
  member: Staff;
  services: string;
  selected: boolean;
  reason?: string;
}) {
  const id = `specialist-${member.id}`;
  return (
    <label
      htmlFor={id}
      data-checked={selected || undefined}
      data-disabled={!!reason || undefined}
      className="flex min-w-0 cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3.5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-muted data-checked:shadow-[inset_0_0_0_1px_var(--primary)] data-disabled:cursor-not-allowed data-disabled:bg-muted sm:gap-3.5 sm:p-4"
    >
      <RadioGroupItem
        id={id}
        value={member.id}
        nativeButton
        render={<button type="button" />}
        disabled={!!reason}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-services${reason ? ` ${id}-reason` : ""}`}
        className="size-4.5"
      />
      <Avatar
        className="size-10 shrink-0 border border-border"
        aria-hidden="true"
      >
        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-name`} className="text-[15px] font-medium">
          {member.name}
        </span>
        <span
          id={`${id}-services`}
          className="text-[13px] text-muted-foreground"
        >
          {services}
        </span>
        {reason && (
          <span
            id={`${id}-reason`}
            className="text-[13px] text-muted-foreground"
          >
            {reason}
          </span>
        )}
      </span>
    </label>
  );
}
