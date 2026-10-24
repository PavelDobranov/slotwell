import { Badge } from "@/app/_components/badge";

export function BookingHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-14 max-w-280 flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold">
            Студио Искра<span className="hidden sm:inline"> — демо салон</span>
          </p>
          <p className="hidden text-sm text-muted-foreground sm:block">
            София · Подстригване и грижа за косата
          </p>
        </div>
        <div className="contents sm:flex sm:items-center sm:gap-2">
          <Badge variant="outline">
            Демо<span className="sm:hidden"> · без реален запис</span>
          </Badge>
          <p className="w-full text-xs text-muted-foreground sm:w-auto sm:text-sm">
            Демо версия — не се създава реална резервация.
          </p>
        </div>
      </div>
    </header>
  );
}
