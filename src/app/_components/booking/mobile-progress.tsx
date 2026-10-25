export function MobileProgress({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <span className="text-sm text-foreground lg:hidden">
      <span className="text-muted-foreground">
        Стъпка {current} от {total} ·{" "}
      </span>
      <strong className="font-semibold">{label}</strong>
    </span>
  );
}
