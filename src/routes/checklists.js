const express = require('express');
const checklistService = require('../services/checklistService');
const { parseIdParam } = require('../utils/validate');

const router = express.Router();

// 创建巡检清单
router.post('/', (req, res) => {
  const checklist = checklistService.createChecklist(req.body);
  res.status(201).json(checklist);
});

// 复制清单生成新版本（可选覆盖 items / cycle_days）
router.post('/:id/copies', (req, res) => {
  const checklist = checklistService.copyChecklistVersion(parseIdParam(req.params.id), req.body || {});
  res.status(201).json(checklist);
});

module.exports = router;
