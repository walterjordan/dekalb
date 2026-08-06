// One place that turns database values into words a person says out loud.
//
// The database values themselves never change: they are the state machine, and
// renaming them would be a refactor. This file is the display layer, and it
// exists because the same enum was previously being shown three different ways
// on three screens (EN_ROUTE was "EN ROUTE" on the board, "Getting ready" on
// its own button, and "Sending them now" on the teacher's phone).
//
// Rule for anything added here: write what a parent or a front-desk staff
// member would say, not what the column is called.

/** Where a child is in the pickup ladder. Seen by floor staff and admins. */
export const PICKUP_STATUS: Record<string, string> = {
  REQUESTED: 'Requested',
  NEEDS_APPROVAL: 'Needs approval',
  EN_ROUTE: 'On the way',
  READY: 'At the door',
  RELEASED: 'Released',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
};

/** How the adult identified themselves. Never shown raw; used in sentences. */
export const REQUEST_METHOD: Record<string, string> = {
  QR: 'scanned the family code',
  PIN: 'used the family PIN',
  SEARCH: 'was found by name or phone number',
  STAFF: 'was entered by a staff member',
  PARENT_LINK: 'came from the parent pickup page',
};

/** How the child is going home. */
export const DISMISSAL: Record<string, string> = {
  CARLINE: 'Carline',
  WALKUP: 'Walk-up',
  BUS: 'Bus',
};

/** Attendance state for a single child today. */
export const ATTENDANCE: Record<string, string> = {
  CHECKED_IN: 'Checked in',
  ABSENT: 'Absent',
  RELEASED: 'Picked up',
  RELEASED_LATE: 'Picked up late',
};

/** Who the collecting adult is to the family. */
export const REQUESTER_KIND: Record<string, string> = {
  GUARDIAN: 'parent or guardian',
  AUTHORIZED: 'approved pickup adult',
  UNKNOWN: 'not on the approved list',
};

export const STAFF_ROLE: Record<string, string> = {
  ADMIN: 'Director',
  SUPERVISOR: 'Supervisor',
  TEACHER: 'Teacher',
  STAFF: 'Staff',
};

export const AUTHORIZED_STATUS: Record<string, string> = {
  ACTIVE: 'Approved',
  PENDING_PARENT_VERIFY: 'Waiting for a parent to confirm',
  REVOKED: 'Removed',
};

export const ANNOUNCEMENT_AUDIENCE: Record<string, string> = {
  ALL: 'all families',
  GRADE: 'one grade',
  BALANCE_DUE: 'families with a balance',
};

/**
 * Audit actions, as they appear in the Activity record. Written as short
 * phrases rather than SHOUTING_ENUMS so the ledger reads like a list of things
 * that happened rather than a system log.
 */
export const AUDIT_ACTION: Record<string, string> = {
  CHECK_IN: 'Checked in',
  CHECK_IN_UNDONE: 'Check-in undone',
  ABSENT: 'Marked absent',
  PICKUP_REQUESTED: 'Pickup requested',
  HELD_UNAPPROVED: 'Held for approval',
  HELD_RESTRICTION: 'Held, front office',
  APPROVAL_SENT: 'Approval text sent',
  APPROVED: 'Approved by parent',
  APPROVAL_DENIED: 'Denied by parent',
  DENIED: 'Pickup denied',
  EN_ROUTE: 'On the way',
  READY: 'At the door',
  RELEASED: 'Released',
  RELEASE_REVERSED: 'Release corrected',
  OVERRIDE: 'Supervisor override',
  ADULT_AUTHORIZED: 'Adult approved',
  ADULT_REVOKED: 'Adult removed',
  RESTRICTION_ADDED: 'Restriction added',
  RESTRICTION_ENDED: 'Restriction ended',
  STUDENT_ADDED: 'Student added',
  STUDENT_DEACTIVATED: 'Student removed',
  HOUSEHOLD_ADDED: 'Family added',
  GUARDIAN_ADDED: 'Parent added',
  ROSTER_IMPORTED: 'Roster imported',
  PARENT_LINK_SENT: 'Pickup link sent',
  ANNOUNCEMENT_SENT: 'Announcement sent',
  DEVICE_ADDED: 'Kiosk added',
  DEVICE_REVOKED: 'Kiosk removed',
  SIGNED_IN: 'Signed in',
  PASSWORD_SET: 'Password set',
  CHAIN_REBASELINE: 'Record re-checked from here',
};

/** Fall back to sentence case so a new action never renders as SHOUTY_SNAKE. */
function humanise(raw: string): string {
  const s = raw.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pickupStatusLabel(v: string): string {
  return PICKUP_STATUS[v] || humanise(v);
}
export function dismissalLabel(v: string): string {
  return DISMISSAL[v] || humanise(v);
}
export function attendanceLabel(v: string): string {
  return ATTENDANCE[v] || humanise(v);
}
export function requesterKindLabel(v: string): string {
  return REQUESTER_KIND[v] || humanise(v);
}
export function staffRoleLabel(v: string): string {
  return STAFF_ROLE[v] || humanise(v);
}
export function auditActionLabel(v: string): string {
  return AUDIT_ACTION[v] || humanise(v);
}
export function authorizedStatusLabel(v: string): string {
  return AUTHORIZED_STATUS[v] || humanise(v);
}
export function announcementAudienceLabel(v: string): string {
  return ANNOUNCEMENT_AUDIENCE[v] || humanise(v);
}

/**
 * "The request was made at 3:36 PM by scanning the family code."
 * Used in audit detail, which is read by a director months later trying to
 * reconstruct what happened, so it has to stand on its own.
 */
export function howRequested(method: string, at: string): string {
  const how = REQUEST_METHOD[method];
  if (method === 'STAFF') return `The request was entered by a staff member at ${at}.`;
  if (method === 'PARENT_LINK') return `The request came from the parent pickup page at ${at}.`;
  return how
    ? `The request was made at ${at} and the adult ${how}.`
    : `The request was made at ${at}.`;
}
