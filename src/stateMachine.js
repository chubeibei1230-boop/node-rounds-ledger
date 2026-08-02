'use strict';

const { invalidTransition } = require('./errors');

/**
 * Round lifecycle state machine.
 *
 *   scheduled ──▶ in_progress ──▶ submitted ──▶ closed
 *
 * The only legal transitions are the sequential steps above. In particular a
 * round can never jump from `scheduled` straight to `closed`; it must pass
 * through `in_progress` and `submitted` first.
 */
const ROUND_STATUSES = ['scheduled', 'in_progress', 'submitted', 'closed'];

const ALLOWED_TRANSITIONS = {
  scheduled: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['closed'],
  closed: [],
};

function canTransition(from, to) {
  const targets = ALLOWED_TRANSITIONS[from] || [];
  return targets.includes(to);
}

/**
 * Assert that a transition from -> to is legal, throwing an AppError otherwise.
 */
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw invalidTransition(
      `Round cannot transition from '${from}' to '${to}'`,
      { from, to, allowed_next: ALLOWED_TRANSITIONS[from] || [] },
    );
  }
}

module.exports = { ROUND_STATUSES, ALLOWED_TRANSITIONS, canTransition, assertTransition };
