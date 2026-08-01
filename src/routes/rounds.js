const express = require('express');
const roundService = require('../services/roundService');
const { parseIdParam } = require('../utils/validate');

const router = express.Router();

// 生成巡检轮次
router.post('/', (req, res) => {
  const round = roundService.createRound(req.body);
  res.status(201).json(round);
});

// 按区域查询未关闭轮次（round_status != closed）
router.get('/open', (req, res) => {
  const rounds = roundService.listOpenRoundsByArea(req.query.area);
  res.json({ rounds });
});

// 查询轮次详情（含结果与异常）
router.get('/:id', (req, res) => {
  const detail = roundService.getRoundDetail(parseIdParam(req.params.id));
  res.json(detail);
});

// 开始巡检：scheduled -> in_progress
router.post('/:id/start', (req, res) => {
  const round = roundService.startRound(parseIdParam(req.params.id));
  res.json(round);
});

// 提交巡检结果：in_progress -> submitted，异常项自动生成复核记录
router.post('/:id/submit', (req, res) => {
  const detail = roundService.submitRoundResults(parseIdParam(req.params.id), req.body);
  res.json(detail);
});

// 关闭轮次：submitted -> closed（要求异常均已复核）
router.post('/:id/close', (req, res) => {
  const round = roundService.closeRound(parseIdParam(req.params.id));
  res.json(round);
});

module.exports = router;
