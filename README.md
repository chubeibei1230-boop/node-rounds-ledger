# node-rounds-ledger

设备巡检轮次台账服务。面向运维团队，把分散在聊天记录里的巡检安排沉淀为**可查询、可追踪**的纯后端服务：管理设备档案、巡检清单、计划轮次、执行结果与异常复核，并提供区域/风险维度的统计查询。

- 运行时：Node.js（内置 `node:sqlite`，需 `--experimental-sqlite`）+ Express 4
- 持久化：SQLite（单文件 `data/ledger.db`）
- 监听端口：**18102**
- 接口前缀：`/api/v1`，字段统一 **snake_case**
- 错误响应固定为：`{ "error_code": "...", "message": "...", "details": { ... } }`

## 快速开始

```bash
npm install
npm start        # 启动服务，监听 http://localhost:18102
npm test         # 运行测试（node --test）
```

> 需要 Node 18+（本仓库在 Node 22 验证）。SQLite 使用 Node 内置模块，无需编译原生依赖。

## 目录结构（分层）

```
server.js                     # 进程入口：建库目录、装配 app、listen(18102)
src/
  app.js                      # Express 应用装配（注册路由与中间件）
  errors.js                   # AppError 与语义化错误工厂
  stateMachine.js             # 轮次状态机（合法流转 + 断言）
  validation.js               # 请求字段校验工具
  db/
    connection.js             # 连接管理 / 内存库（测试用）
    schema.js                 # 建表 DDL
  dao/                        # 数据访问层（纯 SQL，无业务规则）
    deviceDao.js
    checklistDao.js
    roundDao.js
  services/                   # 服务层（业务规则、事务、状态机）
    deviceService.js
    checklistService.js
    roundService.js
  routes/                     # 路由层（解析请求、调用服务、返回）
    deviceRoutes.js
    checklistRoutes.js
    roundRoutes.js
  middleware/
    errorHandler.js           # 统一错误中间件 + 404 处理
test/                         # node:test 端到端测试（内存库）
```

## 数据模型

| 表 | 关键字段 |
| --- | --- |
| `devices` | `device_code`(唯一)、`device_name`、`area`、`device_type`、`risk_level`(low/medium/high)、`enabled`、`maintenance_note` |
| `checklists` | `checklist_name`、`device_type`、`items`(JSON 数组)、`cycle_days`、`version`、`enabled`；`(checklist_name, version)` 唯一 |
| `rounds` | `device_id`、`checklist_id`、`planned_start_at`、`planned_end_at`、`round_status`、`owner_name`、`checklist_snapshot`(生成时固化) |
| `round_results` | `round_id`、`item_key`、`result`(normal/attention/fault/skipped)、`remark`；`(round_id, item_key)` 唯一 |
| `exception_reviews` | `round_id`、`result_id`、`item_key`、`severity`(attention/fault)、`review_status`(pending/confirmed/ignored/resolved)、`reviewer_name`、`review_comment` |

## 业务约束（核心）

1. **状态机**：`scheduled → in_progress → submitted → closed`，只能逐级推进。
   - 明确禁止 `scheduled` 直接到 `closed`；也不能跳过 `in_progress`/`submitted`。
2. **生成轮次**：设备必须存在且未停用；清单必须存在且启用；清单 `device_type` 必须与设备一致；`planned_end_at` 不得早于 `planned_start_at`（相等允许）。生成时把清单固化为 `checklist_snapshot`，后续清单改版不影响历史轮次。
3. **提交结果**：仅允许在 `in_progress` 提交；`results` 数量必须等于快照 `items` 数量，并按**位置 + item_key** 一一对应（乱序、改名、数量不符一律 400）；`result` 只能是 `normal/attention/fault/skipped`。
4. **异常复核**：提交时 `attention`/`fault` 自动生成 `pending` 复核记录。复核结论可为 `confirmed`/`ignored`/`resolved`。
5. **关闭前置**：存在未解决异常（`pending` 或 `confirmed`）时不可关闭；仅当全部异常为 `ignored`/`resolved` 才能关闭。
6. **清单版本**：新建清单版本从 1 开始；同名清单需通过“复制版本”接口生成，新版本号取同名最大值 +1，并在事务内**禁用源版本**。禁用的清单不可复制。
7. **超期判断**：查询接口对 `planned_end_at < now 且 round_status != 'closed'` 动态标记 `overdue`，不改写数据库状态。

## 提交结果校验说明（强化）

运维首批数据反馈校验不够严格，现对「提交结果 / 生成轮次 / 复制清单」做如下明确约束：

### 提交结果（`POST /rounds/:id/results`）
结果集必须与该轮次自身固化的 `checklist_snapshot.items` **严格一致**，任一不满足即返回 `400 validation_error`：

| 校验点 | 规则 | 违例示例 | details |
| --- | --- | --- | --- |
| 数量 | `results.length` 必须等于快照项数量，不能多传/少传 | 快照 2 项，传 1 项或 3 项 | `{expected, received}` |
| 顺序 | 按**位置**逐项比对 `item_key`，乱序即失败 | `[noise, pressure]` 对 `[pressure, noise]` | `{index, expected_item_key, received_item_key}` |
| 改名 | 位置正确但 `item_key` 被改名同样失败 | `noise` → `noise_renamed` | `{index, expected_item_key, received_item_key}` |
| 枚举 | `result` 只能是 `normal/attention/fault/skipped` | `result: "broken"` | `{field, allowed}` |
| 状态 | 仅 `in_progress` 可提交，否则 `invalid_state_transition` | 对 `scheduled` 提交 | `{from, to, allowed_next}` |

### 生成轮次（`POST /rounds`）
- `planned_end_at` **不得早于** `planned_start_at`（相等允许），违例 `400`。
- **停用设备**（`enabled=0`）不能生成新轮次，返回 `409 conflict`。
- 清单不存在返回 `404`；清单被禁用或 `device_type` 与设备不一致返回 `409`。

### 复制清单（`POST /checklists/:id/copy`）
- 源清单**不存在**返回 `404 not_found`。
- 源清单**已禁用**返回 `409 conflict`（禁用的清单不可复制）。
- 复制成功则在事务内生成 `max(version)+1` 的新版本并禁用源版本。

### 状态机
`scheduled → in_progress → submitted → closed` 逐级推进；从 `scheduled` **直接关闭**会被拒绝（`409 invalid_state_transition`，`details.allowed_next=["in_progress"]`）。

## 清单快照语义（历史轮次隔离）

巡检负责人要求**历史轮次不受清单更新影响**。为此生成轮次时固化一份清单快照：

- **生成时机**：`POST /rounds` 成功时，把当时清单的 `checklist_id`、`checklist_name`、`version`、`device_type` 和 `items` 数组整体写入 `rounds.checklist_snapshot`。
- **存储语义**：`items` 全程沿用**首轮约定的 JSON 数组语义**（数据库中以 JSON 字符串持久化，读取时解析为对象数组），**不允许**改为逗号拼接字符串。
- **只读返回**：`GET /rounds/:id`（以及所有返回轮次的接口）都会解析并返回 `checklist_snapshot` 对象，其中 `items` 为数组。
- **校验依据**：提交结果时以**该轮次自身快照**的项数量、顺序和 `item_key` 为准，而非清单当前状态。
- **隔离效果**：后续对清单执行「复制新版本」或调整内容，只影响新生成的轮次；旧轮次的快照与提交校验保持不变。例如清单升到 v2 换成了 `vibration` 项后，v1 轮次提交 `vibration` 会 400，提交原 `[pressure, noise]` 仍成功。

`checklist_snapshot` 结构示例：

```json
{
  "checklist_id": 1,
  "checklist_name": "Pump Routine",
  "version": 1,
  "device_type": "pump",
  "items": [
    { "item_key": "pressure", "label": "Check pressure" },
    { "item_key": "noise", "label": "Check noise" }
  ]
}
```


## 异常复核与关闭前置

区域负责人要求**异常复核成为关闭轮次的前置条件**，流程如下：

1. **自动生成待复核记录**：提交执行结果时，只要存在 `fault`（或 `attention`）项，系统在同一事务内为每个异常项自动创建一条 `exception_reviews` 记录，初始 `review_status = pending`。
2. **复核结论**：`POST /rounds/:id/reviews/:reviewId` 记录复核结论，取值为 `confirmed`（确认存在问题、待处理）、`ignored`（判定可忽略）、`resolved`（已处理）。需带 `reviewer_name`，`review_comment` 可选。
3. **关闭前置**：`POST /rounds/:id/close` 时，仅当该轮次**所有异常都为 `ignored` 或 `resolved`** 才允许进入 `closed`；只要还有 `pending` 或 `confirmed`，返回 `409 conflict` 且 `details.pending_exceptions` 给出未解决数量。
4. **状态流转不可绕过**：关闭仍必须经由 `in_progress → submitted`，`scheduled` 直接关闭会被状态机拒绝（`409 invalid_state_transition`）。
5. **可视化**：`GET /rounds/open?area=` 返回的每个未关闭轮次都会附带 `pending_exceptions`（未解决异常数量，含 `pending` 与 `confirmed`）。

> `confirmed` 表示“已确认是问题但尚未处理”，因此**不清除**异常、仍会阻塞关闭；只有 `ignored`/`resolved` 才算处置完毕。


## 区域风险汇总（区域视角）

运维主管需要从区域视角判断巡检压力和风险分布。`GET /rounds/risk-summary` 按 `area` 和 `risk_level` **分组**汇总，`area`、`risk_level` 均为可选过滤参数（`risk_level` 非法值返回 `400`）。

- **完全复用既有数据**：所有指标都来自已有的 `rounds.round_status`、`round_results` 与 `exception_reviews`，**不新增任何独立状态字段**。
- **overdue 动态计算**：对未关闭轮次，若当前时间已超过 `planned_end_at`，则计入 `overdue_rounds` 并将 `overdue` 置为 `true`；该判断只在查询时计算，**绝不改写数据库中的 `round_status`**。

每个分组返回：

| 字段 | 含义 |
| --- | --- |
| `area` / `risk_level` | 分组维度 |
| `open_rounds` | 未关闭轮次数量（`round_status != 'closed'`） |
| `closed_rounds` | 已关闭轮次数量 |
| `exception_items` | 异常检查项数量（`round_results` 中 `attention`/`fault`） |
| `pending_exceptions` | 待复核异常数量（`exception_reviews` 中 `pending`/`confirmed`） |
| `overdue_rounds` | 超期未关闭轮次数量 |
| `overdue` | 是否存在超期未关闭轮次（计算得出，不落库） |

示例：

```bash
curl "http://localhost:18102/api/v1/rounds/risk-summary?area=B1&risk_level=high"
```

```json
{
  "summary": [
    {
      "area": "B1",
      "risk_level": "high",
      "open_rounds": 2,
      "closed_rounds": 1,
      "exception_items": 3,
      "pending_exceptions": 1,
      "overdue_rounds": 1,
      "overdue": true
    }
  ]
}
```


## 接口一览

所有路径以 `/api/v1` 开头。

### 设备
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/devices` | 创建设备 |
| GET | `/devices/:id` | 查询设备 |
| POST | `/devices/:id/disable` | 停用设备（幂等） |
| GET | `/devices/:id/rounds?limit=10` | 设备最近轮次 |

### 清单
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/checklists` | 创建清单（version=1） |
| GET | `/checklists/:id` | 查询清单 |
| POST | `/checklists/:id/copy` | 复制为新版本（禁用源版本） |

### 轮次
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/rounds` | 生成轮次 |
| GET | `/rounds/:id` | 查询轮次（含快照） |
| POST | `/rounds/:id/start` | 开始巡检（→ in_progress） |
| POST | `/rounds/:id/results` | 提交结果（→ submitted） |
| POST | `/rounds/:id/reviews/:reviewId` | 异常复核 |
| POST | `/rounds/:id/close` | 关闭轮次（→ closed） |
| GET | `/rounds/open?area=B1` | 按区域查未关闭轮次（含 `pending_exceptions`、`overdue`） |
| GET | `/rounds/exceptions?risk_level=high` | 按风险等级查异常 |
| GET | `/rounds/exceptions/by-area` | 区域异常统计 |
| GET | `/rounds/risk-summary?area=B1&risk_level=high` | 区域/风险等级风险汇总（area、risk_level 均可选） |

## 请求示例

创建设备：

```bash
curl -X POST http://localhost:18102/api/v1/devices \
  -H 'content-type: application/json' \
  -d '{"device_code":"DEV-001","device_name":"Pump A","area":"B1","device_type":"pump","risk_level":"high"}'
```

创建清单：

```bash
curl -X POST http://localhost:18102/api/v1/checklists \
  -H 'content-type: application/json' \
  -d '{"checklist_name":"Pump Routine","device_type":"pump","cycle_days":30,
       "items":[{"item_key":"pressure","label":"Check pressure"},
                {"item_key":"noise","label":"Check noise"}]}'
```

生成 → 开始 → 提交 → 复核 → 关闭：

```bash
curl -X POST http://localhost:18102/api/v1/rounds \
  -H 'content-type: application/json' \
  -d '{"device_id":1,"checklist_id":1,
       "planned_start_at":"2026-08-10T08:00:00.000Z",
       "planned_end_at":"2026-08-10T12:00:00.000Z","owner_name":"Alice"}'

curl -X POST http://localhost:18102/api/v1/rounds/1/start

curl -X POST http://localhost:18102/api/v1/rounds/1/results \
  -H 'content-type: application/json' \
  -d '{"results":[{"item_key":"pressure","result":"fault","remark":"leaking"},
                  {"item_key":"noise","result":"normal"}]}'

curl -X POST http://localhost:18102/api/v1/rounds/1/reviews/1 \
  -H 'content-type: application/json' \
  -d '{"review_status":"resolved","reviewer_name":"Bob","review_comment":"gasket replaced"}'

curl -X POST http://localhost:18102/api/v1/rounds/1/close
```

## 错误码

| error_code | HTTP | 场景 |
| --- | --- | --- |
| `validation_error` | 400 | 字段缺失/类型错误/枚举越界/结果数量或顺序不符 |
| `not_found` | 404 | 设备/清单/轮次/复核记录不存在，或未知路由 |
| `conflict` | 409 | 唯一约束冲突、设备/清单停用、类型不匹配、存在未解决异常 |
| `invalid_state_transition` | 409 | 非法的轮次状态流转 |
| `internal_error` | 500 | 未预期的服务器错误 |

## 测试

```bash
npm test
```

覆盖：设备创建/停用与校验、清单版本与复制、轮次状态机（含禁止 `scheduled→closed`）、结果提交校验、异常自动生成与关闭前置、快照隔离，以及最近轮次 / 未关闭轮次 / 风险异常 / 区域统计等查询接口。
