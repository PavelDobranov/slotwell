import { Avatar, AvatarFallback, AvatarImage } from "@/app/_components/avatar";
import { RadioGroupItem } from "@/app/_components/radio-group";
import type { StaffView } from "@/app/_features/booking/api";

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");
}

export function SpecialistOption({
  member,
  selected,
}: {
  member: StaffView;
  selected: boolean;
}) {
  const id = `staff-${member.id}`;
  return (
    <label
      htmlFor={id}
      data-checked={selected || undefined}
      className="flex min-h-18 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected"
    >
      <Avatar className="size-11 shrink-0" aria-hidden="true">
        {member.imageUrl && <AvatarImage src={member.imageUrl} alt="" />}
        <AvatarFallback className="bg-accent text-base font-semibold text-accent-foreground">
          {initials(member.name)}
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
          id={`${id}-description`}
          className="text-sm text-muted-foreground wrap-anywhere"
        >
          {member.description}
        </span>
      </span>
      <RadioGroupItem
        id={id}
        value={member.id}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-description`}
        className="size-5.5"
      />
    </label>
  );
}
