// Hall layout and default shift timings. Changing the layout only affects a database with no seats yet.
// Shift timings can be changed in the app (Bookings & shifts → Shift timings); these are the defaults.

export const HALL = {
  rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  seatsPerRow: 10,
  aisleAfter: 5, // walkway between seat 5 and 6 of every row
};

export const CAPACITY = HALL.rows.length * HALL.seatsPerRow;

// A seat can be shared by one morning and one evening member; "full" covers both.
export const SHIFT_KEYS = ['morning', 'evening', 'full'];

export const DEFAULT_SHIFT_TIMES = {
  morning: { label: 'Morning', start: '06:00', end: '14:00' },
  evening: { label: 'Evening', start: '14:00', end: '22:00' },
  full: { label: 'Full day' }, // runs from morning start to evening end
};
