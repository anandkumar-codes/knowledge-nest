const { JWT_SECRET, PORT = 5000 } = process.env;

if (!JWT_SECRET || JWT_SECRET === 'change-me') {
  console.error('Set a real JWT_SECRET in server/.env (see server/.env.example).');
  process.exit(1);
}

// Imported after the env check so the database file isn't created for a misconfigured start.
const { dbFile } = await import('./db.js');
const { createApp } = await import('./app.js');
const { findSuperAdmin } = await import('./models/users.js');
const { ensureSeats } = await import('./models/seats.js');
const { backfillMembersFromBookings } = await import('./models/members.js');

console.log(`Using SQLite database at ${dbFile}`);
const { TIME_ZONE, today } = await import('./utils/dates.js');
try {
  console.log(`Dates use the ${TIME_ZONE} time zone (today is ${today()}).`);
} catch {
  console.error(`APP_TIMEZONE "${TIME_ZONE}" is not a valid time zone. Use a name like Asia/Kolkata.`);
  process.exit(1);
}
const createdSeats = await ensureSeats();
if (createdSeats) console.log(`Created ${createdSeats} seats.`);
const backfilled = await backfillMembersFromBookings();
if (backfilled) console.log(`Created ${backfilled} member records from existing bookings.`);
if (!(await findSuperAdmin())) {
  console.warn('No super admin yet. Run `npm run seed` to create one.');
}

const { startDailyBackups } = await import('./backup.js');
startDailyBackups();

createApp().listen(PORT, () => {
  console.log(`Knowledge Nest API listening on http://localhost:${PORT}`);
});
