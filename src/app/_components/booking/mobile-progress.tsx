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
    <p className="text-sm sm:hidden">
      <span className="text-muted-foreground">
        Стъпка {current} от {total} ·{" "}
      </span>
      <strong className="font-semibold">{label}</strong>
    </p>
  );
}
