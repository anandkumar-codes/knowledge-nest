// Single source of truth for what can be granted to a role.
// The super admin implicitly holds every permission and is never assigned a role.

export const PERMISSIONS = [
  { key: 'dashboard.view', group: 'Dashboard', label: 'View dashboard' },

  { key: 'seats.view', group: 'Seats', label: 'View seat layout' },
  { key: 'seats.manage', group: 'Seats', label: 'Edit seats & allocate them' },

  { key: 'members.view', group: 'Members', label: 'View members' },
  { key: 'members.manage', group: 'Members', label: 'Register & edit members' },

  { key: 'bookings.view', group: 'Bookings & shifts', label: 'View bookings' },
  { key: 'bookings.manage', group: 'Bookings & shifts', label: 'Create & cancel bookings' },

  { key: 'payments.view', group: 'Payments', label: 'View fee records' },
  { key: 'payments.manage', group: 'Payments', label: 'Collect & refund fees' },

  { key: 'reports.view', group: 'Reports', label: 'View reports' },

  { key: 'team.view', group: 'Team', label: 'View team members' },
  { key: 'team.manage', group: 'Team', label: 'Add, edit & disable team members' },
  { key: 'roles.manage', group: 'Team', label: 'Create & edit roles' },

  { key: 'settings.manage', group: 'Settings', label: 'Manage reading room settings' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const all = PERMISSION_KEYS;
const except = (...keys) => all.filter((k) => !keys.includes(k));

export const DEFAULT_ROLES = [
  {
    name: 'Manager',
    description: 'Runs day-to-day operations and the front-desk team.',
    permissions: except('roles.manage', 'settings.manage'),
  },
  {
    name: 'Front Desk',
    description: 'Handles walk-ins, seat allocation and member registration.',
    permissions: [
      'dashboard.view', 'seats.view', 'seats.manage', 'members.view', 'members.manage',
      'bookings.view', 'bookings.manage', 'payments.view',
    ],
  },
  {
    name: 'Accountant',
    description: 'Collects fees and reviews financial reports.',
    permissions: ['dashboard.view', 'members.view', 'payments.view', 'payments.manage', 'reports.view'],
  },
];
