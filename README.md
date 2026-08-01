# node-rounds-ledger

设备巡检轮次台账服务，面向运维团队管理设备档案、巡检清单、计划轮次、异常复核和区域统计，重点考察 Node.js 后端分层、SQLite 持久化和流程约束。

## 技术栈

- Node.js（>= 22.5，使用内置 `node:sqlite`，通过 `--experimental-sqlite` 启用）
- Express 4
- SQLite（文件持久化，默认 `data/ledger.db`；测试使用内存库）

## 快速开始

```bash
npm install
npm start        # 监听 18102 端口
npm test         # 运行全部测试（内存数据库，端口随机）
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `18102` | 服务监听端口 |
| `DB_FILE` | `data/ledger.db` | SQLite 文件路径，`:memory:` 表示内存库 |

## 目录结构

```
src/
  index.js                  # 启动入口（端口 18102）
  app.js                    # Express 应用装配
  config.js                 # 端口 / 数据库配置
  db/                       # 连接与 Schema
  routes/                   # 路由层：devices / checklists / rounds / exceptions / stats
  services/                 # 服务层：业务规则与事务
  repositories/             # 数据访问层：SQL 读写
  stateMachine/             # 轮次状态机
  middleware/errorHandler.js# 统一错误中间件与 404
  errors/ApiError.js        # 业务错误类型
  utils/validate.js         # 入参校验
test/                       # node:test 测试
```

## 通用约定

- 接口统一以 `/api/v1` 开头，请求与响应字段均为 snake_case。
- 错误响应固定格式：

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "缺少必填字段",
  "details": { "missing_fields": ["area"] }
}
```

- `error_code` 取值：`VALIDATION_ERROR`(400)、`NOT_FOUND`(404)、`CONFLICT`(409)、`INVALID_STATE`(409)、`INTERNAL_ERROR`(500)。
- 轮次状态机：`scheduled -> in_progress -> submitted -> closed`，仅允许沿箭头单向流转（禁止 `scheduled` 直接到 `closed`）。
- 结果项取值：`normal`、`attention`、`fault`、`skipped`；其中 `attention` / `fault` 会自动生成待复核异常记录。
- 提交结果时，检查项的数量、顺序、`item_key` 必须与轮次保存的清单快照 `items` 完全一致，不允许少传、多传、乱序或改名。
- 生成轮次时固化清单快照 `checklist_snapshot`（含 `checklist_name`、`version`、`device_type`、`items`，`items` 为 JSON 数组而非拼接字符串）；清单后续复制新版本或调整内容时，历史轮次仍按各自快照校验。
- `planned_end_at` 不能早于 `planned_start_at`（两者相等允许）。
- 轮次关闭前置条件：处于 `submitted` 且所有异常复核结论均为 `ignored` 或 `resolved`（`pending` / `confirmed` 均阻止关闭）。
- 异常复核结论取值：`confirmed`（已确认待处理）、`ignored`（无需处理）、`resolved`（已解决）。
- 风险等级：`low`、`medium`、`high`、`critical`。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/devices` | 创建设备 |
| PATCH | `/api/v1/devices/:id/disable` | 停用设备 |
| GET | `/api/v1/devices/:id/rounds/latest` | 查询设备最近轮次（含结果项） |
| POST | `/api/v1/checklists` | 创建巡检清单 |
| POST | `/api/v1/checklists/:id/copies` | 复制清单生成新版本（可覆盖 `items` / `cycle_days`，旧版本自动禁用） |
| POST | `/api/v1/rounds` | 生成巡检轮次 |
| GET | `/api/v1/rounds/open?area=东区` | 按区域查未关闭轮次（每轮含 `pending_exceptions` 待复核异常数） |
| GET | `/api/v1/rounds/:id` | 轮次详情（含 `checklist_snapshot`、结果与异常） |
| POST | `/api/v1/rounds/:id/start` | 开始巡检 |
| POST | `/api/v1/rounds/:id/submit` | 提交巡检结果 |
| POST | `/api/v1/rounds/:id/close` | 关闭轮次 |
| GET | `/api/v1/exceptions?risk_level=high&review_status=pending` | 按风险等级/复核状态查异常 |
| POST | `/api/v1/exceptions/:id/review` | 异常复核 |
| GET | `/api/v1/stats/exceptions/by-area` | 区域异常统计 |
| GET | `/api/v1/stats/area-risk-summary?area=东区&risk_level=high` | 区域风险汇总（可选 area / risk_level 过滤） |

### 示例

创建设备：

```bash
curl -X POST http://localhost:18102/api/v1/devices \
  -H "Content-Type: application/json" \
  -d '{"device_code":"PUMP-001","device_name":"一号循环泵","area":"东区","device_type":"pump","risk_level":"high","maintenance_note":"每季度加油"}'
```

创建清单（`version` 缺省为 1，`items` 为 `{item_key, item_name}` 数组）：

```bash
curl -X POST http://localhost:18102/api/v1/checklists \
  -H "Content-Type: application/json" \
  -d '{"checklist_name":"循环泵日常巡检","device_type":"pump","cycle_days":7,"items":[{"item_key":"vibration","item_name":"振动检查"},{"item_key":"temperature","item_name":"温度检查"}]}'
```

生成轮次并开始巡检：

```bash
curl -X POST http://localhost:18102/api/v1/rounds \
  -H "Content-Type: application/json" \
  -d '{"device_id":1,"checklist_id":1,"planned_start_at":"2026-08-01T00:00:00Z","planned_end_at":"2026-08-03T00:00:00Z","owner_name":"张三"}'
curl -X POST http://localhost:18102/api/v1/rounds/1/start
```

提交结果（检查项数量、顺序、`item_key` 必须与清单 `items` 完全一致）：

```bash
curl -X POST http://localhost:18102/api/v1/rounds/1/submit \
  -H "Content-Type: application/json" \
  -d '{"results":[{"item_key":"vibration","result":"normal"},{"item_key":"temperature","result":"fault","note":"轴承温度 95℃"}]}'
```

异常复核并关闭轮次（复核结论需为 `ignored` 或 `resolved` 才允许关闭）：

```bash
curl -X POST http://localhost:18102/api/v1/exceptions/1/review \
  -H "Content-Type: application/json" \
  -d '{"reviewer_name":"李工","review_result":"resolved","review_comment":"轴承已更换，复检正常"}'
curl -X POST http://localhost:18102/api/v1/rounds/1/close
```

## 业务约束

- `device_code` 全局唯一；`(checklist_name, version)` 唯一；复制清单时版本号自动取同名最大值 + 1。
- 清单复制成功后，源清单自动置为禁用（`enabled = 0`）；已禁用或不存在的清单不能被复制（分别返回 409 / 404）。
- 轮次创建时保存清单快照 `checklist_snapshot`（`checklist_name` / `version` / `device_type` / `items`，`items` 为 JSON 数组）；轮次详情、提交结果校验均以快照为准，不受清单后续版本更新影响。
- 清单 `device_type` 必须与设备 `device_type` 一致才能生成轮次；已停用设备不能生成新轮次（返回 409）。
- `planned_end_at` 早于 `planned_start_at` 时拒绝生成轮次（返回 400），两者相等允许。
- 提交结果时 `results` 的数量、顺序、`item_key` 必须与清单 `items` 快照逐一对应：数量不一致返回 400（`details.expected_count` / `actual_count`），顺序或名称不一致返回 400（`details.index` / `expected_item_key` / `actual_item_key`），`result` 只能是四种枚举值。
- 异常复核结果只能是 `confirmed`、`ignored` 或 `resolved`，每条异常仅可复核一次；轮次内全部异常达到 `ignored` / `resolved` 后才允许关闭，否则返回 409（`details.unresolved_exceptions`）。
- 区域风险汇总按 `area` + `risk_level` 分组，返回 `open_rounds`（未关闭轮次）、`closed_rounds`（已关闭轮次）、`abnormal_items`（异常检查项数）、`pending_exceptions`（待复核异常数）、`overdue_rounds`（超期未关闭轮次数）与 `overdue` 标记；`overdue` 由当前时间与 `planned_end_at` 在查询时动态计算（未关闭且当前时间超过 `planned_end_at` 即为超期），不改写数据库中的轮次状态。
