const express = require('express');
const exceptionService = require('../services/exceptionService');
const { parseIdParam } = require('../utils/validate');

const router = express.Router();

// 异常查询：支持 risk_level / review_status 过滤
router.get('/', (req, res) => {
  const exceptions = exceptionService.listExceptions(req.query);
  res.json({ exceptions });
});

// 异常复核
router.post('/:id/review', (req, res) => {
  const exception = exceptionService.reviewException(parseIdParam(req.params.id), req.body);
  res.json(exception);
});

module.exports = router;
