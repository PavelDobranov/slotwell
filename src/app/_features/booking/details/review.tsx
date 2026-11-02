import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import type { PersistedContact } from "@/app/_features/booking/context";

/** Review renders the draft; the provider/binding alone authorize submission. */
export function BookingReview({
  contact,
  canConfirm,
  onConfirm,
  onEdit,
}: {
  contact: PersistedContact;
  canConfirm: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <Alert role="note" variant="info">
        <AlertTitle>Все още няма потвърдена резервация.</AlertTitle>
        <AlertDescription>
          Часът се проверява и запазва при потвърждение. След успех ще отворим
          личния линк за преглед на резервацията.
        </AlertDescription>
      </Alert>
      <Card className="rounded-card shadow-none">
        <CardHeader>
          <CardTitle>
            <h3>Контакти и бележка</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-1 whitespace-pre-wrap wrap-anywhere">
          <p className="font-semibold">{contact.name}</p>
          <p>{contact.phone}</p>
          <p>{contact.email}</p>
          <p>{contact.note || "Без бележка"}</p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="outline" onClick={onEdit}>
          Редактирай данните
        </Button>
        <Button disabled={!canConfirm} onClick={onConfirm}>
          Потвърди резервацията
        </Button>
      </div>
    </>
  );
}
