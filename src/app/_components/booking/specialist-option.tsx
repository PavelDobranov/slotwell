import { Avatar, AvatarFallback, AvatarImage } from "@/app/_components/avatar";
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
      className="flex min-h-18 min-w-0 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected data-checked:shadow-[inset_0_0_0_1px_var(--primary)] data-disabled:cursor-not-allowed data-disabled:bg-muted"
    >
      <Avatar
        className="size-11 shrink-0 border border-border"
        aria-hidden="true"
      >
        {member.imageUrl && <AvatarImage src={member.imageUrl} alt="" />}
        <AvatarFallback className="bg-accent text-accent-foreground">
          {member.name
            .split(" ")
            .map((part) => part.charAt(0))
            .join("")}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          id={`${id}-name`}
          className="text-base leading-[22px] font-semibold wrap-anywhere"
        >
          {member.name}
        </span>
        <span
          id={`${id}-services`}
          className="text-[14px] leading-5 text-muted-foreground wrap-anywhere"
        >
          {services}
        </span>
        {reason && (
          <span
            id={`${id}-reason`}
            className="text-[14px] leading-5 text-muted-foreground wrap-anywhere"
          >
            {reason}
          </span>
        )}
      </span>
      <RadioGroupItem
        id={id}
        value={member.id}
        nativeButton
        render={<button type="button" />}
        disabled={!!reason}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-services${reason ? ` ${id}-reason` : ""}`}
        className="size-5.5"
      />
    </label>
  );
}
