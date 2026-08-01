const express = require('express');
const exceptionService = require('../services/exceptionService');
const statsService = require('../services/statsService');

const router = express.Router();

// 区域异常统计
router.get('/exceptions/by-area', (req, res) => {
  const stats = exceptionService.areaExceptionStats();
  res.json({ stats });
});

// 区域风险汇总：按 area + risk_level 统计轮次与异常，overdue 动态计算
router.get('/area-risk-summary', (req, res) => {
  const summary = statsService.areaRiskSummary(req.query);
  res.json({ summary });
});

module.exports = router;
