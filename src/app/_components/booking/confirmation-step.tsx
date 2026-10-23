import { Button } from "@/app/_components/button";
import type { ContactDraft } from "@/app/_lib/booking/state";

export function ConfirmationStep({
  contact,
  onNewBooking,
}: {
  contact: ContactDraft;
  onNewBooking: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p>
        Това не е реална резервация. Часът е зает само в тази демонстрация,
        докато страницата е отворена.
      </p>
      <p className="text-sm text-muted-foreground">
        Не изпращаме имейл и няма достъп за управление на резервация.
        Презареждането изтрива демо резервациите и въведените данни.
      </p>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="font-medium">Име</dt>
          <dd className="break-words">{contact.name}</dd>
        </div>
        <div>
          <dt className="font-medium">Телефон</dt>
          <dd className="break-words">{contact.phone}</dd>
        </div>
        <div>
          <dt className="font-medium">Имейл</dt>
          <dd className="break-words">{contact.email}</dd>
        </div>
        {contact.note && (
          <div>
            <dt className="font-medium">Бележка</dt>
            <dd className="whitespace-pre-wrap break-words">{contact.note}</dd>
          </div>
        )}
      </dl>
      <Button className="min-h-11 self-start" onClick={onNewBooking}>
        Нова демо резервация
      </Button>
    </div>
  );
}
