const { ApiError } = require('../errors/ApiError');

const ROUND_STATUSES = ['scheduled', 'in_progress', 'submitted', 'closed'];

// 状态机：scheduled -> in_progress -> submitted -> closed
// 不允许从 scheduled 直接到 closed，也不允许逆向流转。
const TRANSITIONS = {
  scheduled: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['closed'],
  closed: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw ApiError.invalidState(`轮次状态不允许从 ${from} 变更为 ${to}`, {
      from,
      to,
      allowed_transitions: TRANSITIONS[from] || [],
    });
  }
}

module.exports = { ROUND_STATUSES, TRANSITIONS, canTransition, assertTransition };
