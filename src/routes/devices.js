const express = require('express');
const deviceService = require('../services/deviceService');
const roundService = require('../services/roundService');
const { parseIdParam } = require('../utils/validate');

const router = express.Router();

// 创建设备
router.post('/', (req, res) => {
  const device = deviceService.createDevice(req.body);
  res.status(201).json(device);
});

// 停用设备
router.patch('/:id/disable', (req, res) => {
  const device = deviceService.disableDevice(parseIdParam(req.params.id));
  res.json(device);
});

// 查询设备最近轮次
router.get('/:id/rounds/latest', (req, res) => {
  const round = roundService.getLatestRoundForDevice(parseIdParam(req.params.id));
  res.json(round);
});

module.exports = router;
