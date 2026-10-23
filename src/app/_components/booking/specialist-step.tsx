import { Button } from "@/app/_components/button";
import { qualifiedStaff } from "@/app/_lib/booking/availability";
import type { DemoSalon } from "@/app/_lib/booking/types";

export function SpecialistStep({
  salon,
  serviceIds,
  staffId,
  onSelect,
  onNext,
  onEditServices,
}: {
  salon: DemoSalon;
  serviceIds: readonly string[];
  staffId: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
  onEditServices: () => void;
}) {
  const staff = qualifiedStaff(salon, serviceIds);
  return (
    <>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 font-medium">Избери специалист</legend>
        {staff.map((member) => (
          <label
            key={member.id}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md border p-4 has-[:checked]:border-primary has-[:checked]:bg-secondary"
          >
            <input
              type="radio"
              name="specialist"
              value={member.id}
              checked={staffId === member.id}
              onChange={() => onSelect(member.id)}
              className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{member.name}</span>
              <span className="text-sm text-muted-foreground">
                {member.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {staff.length === 0 && (
        <>
          <output>
            Няма специалист за тази комбинация от услуги. Промени услугите, за
            да продължиш.
          </output>
          <Button
            variant="outline"
            className="self-start"
            onClick={onEditServices}
          >
            Промени избора на услуги
          </Button>
        </>
      )}
      <Button
        className="self-start"
        disabled={!staff.some(({ id }) => id === staffId)}
        onClick={onNext}
      >
        Продължи
      </Button>
    </>
  );
}
