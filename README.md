# Slotwell

## Development

```sh
npm install
npm run dev
```

- Frontend: http://localhost:3000
- API health: http://localhost:3000/api/health → `{"status":"ok"}`

## Booking demo

The date/time step follows D3 and S1/S2/S6 in `docs/booking-wizard-design.html`:
- Seven-day paging and a Bulgarian calendar share the existing availability selector (one-hour lead time, today through 60 days ahead).
- Morning/afternoon counts and the selected visit range use Sofia time; the displayed end excludes cleanup.
- Empty dates offer the next available day, specialist changes, and service edits. Paging alone never changes the booking.
- Availability is synchronous in this demo. `TimeStep` accepts `loading` for the S1 slot skeleton; no artificial loading delay is introduced.

## Checks and production

```sh
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
npm run test:e2e
npm start
```
