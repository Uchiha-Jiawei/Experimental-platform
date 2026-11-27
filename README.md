# 多智能体开发平台模拟框架

本地工作台用固定的任务清单 PRD 演示规划、按依赖开发、独立验收、定向修复与用量统计。运行时无需 API 密钥或远程模型服务。每次运行保留需求、设计、任务、所有产物版本、验收证据与模拟调用明细。

## 启动与验证

使用 Node.js 20 或更新版本，在仓库根目录执行：

```sh
npm ci
npm start
```

打开 http://127.0.0.1:4317 ，新建项目时选择本机已有文件夹或输入其绝对路径，在项目对话中发送消息。支持新建多个对话，侧栏用于切换项目和对话。点击“上传 PRD”选择自己的 Word（.docx、Word 97–2003 .doc）、UTF-8 Markdown 或 TXT 文件，再点击“运行项目”。“项目文件”可以查看磁盘目录和历次上传的原文。要复现任务清单演示，可手动选择仓库的 `fixtures/prd.md`。运行结果在对话中展示，并可打开每个产物版本。

新项目数据保存在所选文件夹的 `.agent-workspace/` 子目录。Word 原件最大 10 MiB，提取的正文上限为 32000 个字符。点击文档名可预览正文，点击“下载原件”可取回上传文件。其中 `project.json` 保存项目名称、创建时间及当前文档索引，`chats/<对话 UUID>.json` 保存消息和运行引用，`documents/` 保存上传的原始文件，`runs/` 保存包含产物和证据的运行快照。显示名称及原文件名保存在元数据中，`PROJECTS_DIR` 指定本机项目索引所在目录（默认 `projects/`）。早期版本创建的项目继续从原目录读取。浏览器 URL 仅保存定位标识，实际数据在服务端磁盘。普通聊天使用本地规则回复，可查询该对话最近一次运行或查看当前需求文档。

运行 `npm test` 检查项目隔离、持久化、上传与框架回归。

| 模拟场景 | 默认预算 | 预期结果 | 模拟 Token |
| --- | ---: | --- | ---: |
| 一次通过 | 3000 | v2 首次通过三项验收 | 660 |
| 缺陷修复 | 3000 | v2 第三项失败，修复后 v3 全部通过 | 900 |
| 预算停止 | 600 | 已完成两项开发，预算不足以发起验收 | 560 |
| 持续失败 | 3000 | 缺陷持续存在，两轮修复后停止 | 1140 |

模拟规划器只识别内置任务清单，其他 PRD 会进入“待确认”。预算和修复上限均可调整。输入、输出用量为固定模拟值，无真实模型计费。

## 三组并行接入

接口版本为 1。模块可返回可序列化对象，也可异步返回这些对象。默认实现由 `core/workflow.js` 装配。可仅替换一个模块，用 `await execute(config, { adapters: { ...defaults, development: myDevelopment } })` 联调。当前框架按依赖顺序执行任务；三个组的开发工作可同时开展。

| 负责方 | 实现入口 | 输入与交付 |
| --- | --- | --- |
| 一组 | `adapters/planning.js` 的 `plan(prd)` | 输入 PRD，返回含版本、设计、验收项和任务依赖的规划包，或返回待确认问题 |
| 二组 | `adapters/development.js` 的 `build`、`repair` | 开发读取任务和上一版产物；修复读取同版本的失败报告。返回新版本的产物描述 |
| 三组 | `adapters/acceptance.js` 的 `verify` | 接受规划包和产物，以独立存储运行新增、完成、重新加载检查，返回版本、用例编号、步骤、实际值及通过标记 |
| 框架负责人 | `core/`、`server.js`、`product/` | 调度、预算、状态快照、公共模型调用记录、产物运行方式和网页入口 |

**第一天的交接样例**在 `fixtures/prd.md` 与 `fixtures/handoff.json`。一组对照 `plan` 实现输出；二组直接使用 `buildInput`、`repairInput`；三组直接使用 `verifyInput`、`fixed` 和 `calls`。对照 `passedReport` 检查恢复后的证据。需要更新样例时执行 `npm run fixtures`，检查契约差异后与三组同步。接口兼容性和独立接入示例见 `test/workflow.test.js`。

## 调度、存储与产物边界

- 调度器检查依赖、验收覆盖、产物和报告版本，执行可用任务。每次模拟调用前检查预算，仅对已发起调用记账。验收失败且仍有额度时执行修复，随后重新运行全部验收项。
- 每个运行有独立 UUID。单进程服务在每个阶段结束后用临时文件加重命名保存 JSON 快照，目录为该项目下的 `runs/`。重启后未完成的运行标为已中断，可按原配置发起新运行。旧版公共运行可通过原有只读接口查看。环境变量 `RUN_DIR` 指向旧版记录，`PORT` 可修改监听端口。
- 模拟产物是版本化功能描述。内置执行器只解释三个布尔能力并运行随框架发布的任务清单实现，每次验收使用新的内存存储。工作台可以打开各版本独立的 HTML 页面，页面与验收使用相同业务代码。接入任意生成代码时，需要另配具备资源限制的隔离执行器，并扩展产物契约。
- 当前验证覆盖业务状态和存储恢复。真实模型、任意项目构建和浏览器自动化验收分别由后续模块接入。模拟调用明细包含调用编号、阶段、任务、模型、输入与输出 Token。

## 本地 HTTP 接口

| 方法与路径 | 作用 |
| --- | --- |
| GET /api/config | 模拟场景列表 |
| GET、POST /api/projects | 列出项目，或按 name、folder（已有文件夹的绝对路径）创建项目及首个对话 |
| POST /api/select-folder | 打开 Windows 文件夹选择器，取消返回空路径 |
| GET /api/projects/{p} | 元数据、目录和对话摘要 |
| POST /api/projects/{p}/documents | 上传原文件，JSON 包含 name 和 Base64 编码的 data |
| GET /api/projects/{p}/documents/{d} | 查看指定版本原文 |
| GET /api/projects/{p}/documents/{d}/original | 下载上传的原始文件 |
| POST /api/projects/{p}/chats | 创建项目内对话 |
| GET /api/projects/{p}/chats/{c} | 读取对话与消息 |
| POST /api/projects/{p}/chats/{c}/messages | 保存文本消息 text 并生成模拟回复 |
| POST /api/projects/{p}/chats/{c}/runs | 运行当前上传的 PRD，可设置 scenario、budget、maxRepairs 和校验用的 documentId |
| GET /api/projects/{p}/runs/{r} | 查看运行 |
| GET /api/projects/{p}/runs/{r}/artifacts/{version} | 打开产物 |

`scenario` 可取 `success`、`repair`、`budget` 或 `stubborn`。应用层终态包括 `passed`、`budget_stop`、`repair_limit`、`clarification`、`failed` 和 `interrupted`。预算停止时可能已有产物，最终达标以当前产物的完整验收结果为准。
