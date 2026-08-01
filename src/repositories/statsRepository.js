function buildWhere(filters) {
  const where = [];
  const params = [];
  if (filters.area) {
    where.push('d.area = ?');
    params.push(filters.area);
  }
  if (filters.risk_level) {
    where.push('d.risk_level = ?');
    params.push(filters.risk_level);
  }
  return { where, params };
}

function withExtraCondition(where, extra) {
  const all = [...where, extra];
  return all.length > 0 ? `WHERE ${all.join(' AND ')}` : '';
}

// 按 area + risk_level 汇总巡检压力与风险分布。
// overdue 仅按当前时间与 planned_end_at 动态计算，不改写轮次状态。
function areaRiskSummary(db, filters, now) {
  const { where, params } = buildWhere(filters);

  const roundRows = db
    .prepare(
      `SELECT d.area, d.risk_level,
              SUM(CASE WHEN r.round_status != 'closed' THEN 1 ELSE 0 END) AS open_rounds,
              SUM(CASE WHEN r.round_status = 'closed' THEN 1 ELSE 0 END) AS closed_rounds,
              SUM(CASE WHEN r.round_status != 'closed' AND r.planned_end_at < ? THEN 1 ELSE 0 END) AS overdue_rounds
       FROM rounds r
       JOIN devices d ON d.id = r.device_id
       ${withExtraCondition(where, '1 = 1')}
       GROUP BY d.area, d.risk_level`
    )
    .all(now, ...params);

  const abnormalRows = db
    .prepare(
      `SELECT d.area, d.risk_level, COUNT(*) AS abnormal_items
       FROM round_results rr
       JOIN rounds r ON r.id = rr.round_id
       JOIN devices d ON d.id = r.device_id
       ${withExtraCondition(where, "rr.result IN ('attention', 'fault')")}
       GROUP BY d.area, d.risk_level`
    )
    .all(...params);

  const pendingRows = db
    .prepare(
      `SELECT d.area, d.risk_level, COUNT(*) AS pending_exceptions
       FROM exception_reviews e
       JOIN devices d ON d.id = e.device_id
       ${withExtraCondition(where, "e.review_status = 'pending'")}
       GROUP BY d.area, d.risk_level`
    )
    .all(...params);

  const groups = new Map();
  const keyOf = (row) => `${row.area}${row.risk_level}`;
  const getGroup = (row) => {
    if (!groups.has(keyOf(row))) {
      groups.set(keyOf(row), {
        area: row.area,
        risk_level: row.risk_level,
        open_rounds: 0,
        closed_rounds: 0,
        abnormal_items: 0,
        pending_exceptions: 0,
        overdue_rounds: 0,
      });
    }
    return groups.get(keyOf(row));
  };

  for (const row of roundRows) {
    const group = getGroup(row);
    group.open_rounds = Number(row.open_rounds);
    group.closed_rounds = Number(row.closed_rounds);
    group.overdue_rounds = Number(row.overdue_rounds);
  }
  for (const row of abnormalRows) {
    getGroup(row).abnormal_items = Number(row.abnormal_items);
  }
  for (const row of pendingRows) {
    getGroup(row).pending_exceptions = Number(row.pending_exceptions);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, overdue: group.overdue_rounds > 0 }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.risk_level.localeCompare(b.risk_level));
}

module.exports = { areaRiskSummary };
