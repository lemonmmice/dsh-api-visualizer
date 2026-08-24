# dsh-api-visualizer（接口捕获面板）

DSH Web GUI 插件：**Fiddler 式实时抓包面板**。可视化展示 本机客户端进程 的 HTTP 接口调用
（列表 / 筛选 / 详情 / 自动滚动 / 复制 URL），并内置**实时捕获引擎**——tail 客户端
System.Net 跟踪日志，自动解析出 方法 / URL / 状态 / 请求头 / 响应头 / 请求体 / 响应体
（gzip 自动解包）并实时入库，无需 agent 手动上报。

## 结构

```
dsh-api-visualizer/
├── package.json          # dsh.bundle.patch + dsh.client(platform: web)
├── cordis.patch.yml      # 注册行 {id: api-visualizer, name: '@linxin666/dsh-api-visualizer'}
├── lib/
│   ├── index.js          # 宿主侧：JSONL 存储 + /api/dsh-api-visualizer 路由（records/stats/capture/proxy/logs）+ api_capture_append 工具 + 提示词通告
│   ├── capture-engine.mjs# 实时捕获引擎：tail System.Net 跟踪日志 + 多线程状态机解析 + gzip 解包（可独立进程运行）
│   ├── proxy-engine.mjs  # 本地 MITM 代理：HTTP 明文 + HTTPS CONNECT 按域签发证书 + 上游代理链 + 系统代理切换
│   ├── client.js         # 浏览器侧：侧边栏「接口捕获」入口 + 面板（纯 DOM，捕获中 1s / 平时 2.5s 轮询）
│   └── scripts/
│       ├── clean-capture-logs.ps1  # 清除日志按钮调用的清理脚本（%TEMP% 跟踪日志 + 抓包目录 *.log）
│       └── install.ps1             # 同事一键安装脚本（下载 + 解压 + 注册两个插件）
└── README.md
```

## 安装（同事 / 新机器）

前提：已安装 DSH（`dsh` 命令可用），PowerShell 5+。

**方式 A：一键脚本**（推荐；自动下载两个插件、解压进 profile 并写入注册，装完重启 DSH）：

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/lemonmmice/dsh-api-visualizer/main/scripts/install.ps1 | iex"
```

**方式 B：命令行**（用 DSH 自带的 pnpm 包装器）：

```sh
dsh plugin --profile web add github:lemonmmice/dsh-api-visualizer
dsh plugin --profile web add github:lemonmmice/dsh-postman
```

然后在 profile 的 `cordis.patch.yml`（如 `~/.dsh/profiles/web/cordis.patch.yml`）追加注册块：

```yaml
- insert:
    - id: api-visualizer
      name: '@linxin666/dsh-api-visualizer'

- insert:
    - id: postman
      name: '@linxin666/dsh-postman'
```

重启 DSH、刷新页面后侧边栏出现「接口捕获」与「接口调试」入口。

> 方式 B 中 postman 安装可能因 pnpm 供应链策略报 `ERR_PNPM_IGNORED_BUILDS`
> （其依赖 protobufjs 带安装脚本）：按提示把打印的键（如 `protobufjs@7.6.5`）加进
> profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重跑即可；protobufjs 的安装脚本
> 对功能无影响，跳过也不影响使用。

## 环境变量

- `DSH_API_CAPTURE_STORE` — 记录库目录（缺省 `~/.dsh/api-capture`，按天分片）；
- `DSH_API_SRC_ROOT` — 客户端源码根目录，「定位源码」在此查找 .cs 定义（多根用 `;` 分隔；缺省无，需自行设置）；
- `DSH_CODE_EXE` — VS Code 可执行文件路径（缺省探测常见安装路径）；
- `DSH_CAPTURE_LOG` / `DSH_CAPTURE_CALLER_LOG` — 跟踪日志 / 调用方日志路径（缺省 `%TEMP%\uiprobe-net-trace.log` / `uiprobe-caller.log`）。

## 使用方式

1. **重启 DSH**（插件注册与 client.js 加载在启动时生效），侧边栏出现「接口捕获」入口。
2. **实时捕获（Fiddler 式）**：面板里点「开始实时捕获」，宿主引擎开始 tail 客户端跟踪日志
   （默认 `%TEMP%\uiprobe-net-trace.log`），客户端流量实时流进列表（source=realtime）；
   点「停止实时捕获」暂停。要求客户端已注入 `system.diagnostics` 跟踪配置并重启过。
3. **agent 手动上报**：用 `api_capture_append` 工具追加记录（method/url 必填），同样实时显示。
4. **直接灌入**：`POST /api/dsh-api-visualizer/ingest`（body `{records:[...]}`，仅限本机回环）。

## API（host 侧，loopback-only）

- `GET  /api/dsh-api-visualizer/stats` — 总数/方法/状态/来源/域名分布
- `GET  /api/dsh-api-visualizer/records?limit&offset&cursor&q&method&source&status&includeBody` — 列表
- `GET  /api/dsh-api-visualizer/records/{id}` — 单条完整记录（含请求/响应体）
- `POST /api/dsh-api-visualizer/ingest` — 追加记录（单批 ≤ 500 条）
- `DELETE /api/dsh-api-visualizer/records` — 清空
- `POST /api/dsh-api-visualizer/capture/start` — 开始实时捕获（body 可选 `{logPath, replay}`；日志 >300MB 自动轮转）
- `POST /api/dsh-api-visualizer/capture/stop` — 停止实时捕获
- `GET  /api/dsh-api-visualizer/capture/status` — 引擎状态 + 实时入库计数
- `POST /api/dsh-api-visualizer/capture/rotate` — 轮转 trace/caller 日志（改名 .bak + 按 keepDays 清理归档）
- `GET  /api/dsh-api-visualizer/stats/timeline|sessions|endpoints|repeats` — 时间分桶/会话聚合/端点聚合/高频重复检测
- `POST /api/dsh-api-visualizer/baseline/save|diff`、`GET /baseline/list`、`DELETE /baseline/{name}` — 契约基线
- `POST /api/dsh-api-visualizer/source/locate`、`POST /source/open` — 调用方源码定位与打开
- `GET/POST/DELETE /api/dsh-api-visualizer/proxy/rules` — AutoResponder 规则引擎（mock/延迟/阻断/重写状态码）

记录字段：`id, ts, source, process, method, url, status, durationMs, reqHeaders, reqBody, resHeaders, resBody, note`
（reqBody/resBody 每字段截断 ≤ 2MB，超出附 `…(截断)` 后缀）。代理流量额外带 `connectMs/tlsMs/ttfbMs`
分段耗时；实时流量带调用方归因 `caller{vm,view,api,trig,stack}`。存储按天分片 `records-YYYYMMDD.jsonl`
（全局上限 20000 条，旧单文件自动迁移）。

## Agent 工具

- `api_capture_append` — 追加记录
- `api_capture_query` — 查询/过滤已捕获记录（q/method/source/status/host/minDurationMs/errors/caller 等，返回调用方归因）

## 抓取侧（实时引擎）

引擎位于 `lib/capture-engine.mjs`，两种运行形态：

1. **宿主内引擎**（面板按钮默认路径）：插件加载时创建，/capture/start 启动，解析结果直写存储。
2. **独立进程**（无宿主改造时的过渡方案）：
   `node lib/capture-engine.mjs`，env `DSH_CAPTURE_LOG`（日志路径）、`DSH_CAPTURE_INGEST`
   （ingest 端点）、`DSH_CAPTURE_REPLAY=1`（重放整份日志）。若检测到宿主引擎已接管会自动退出，避免双写。

数据来源：客户端配置文件（`*.exe.config`）注入 `system.diagnostics`（System.Net / System.Net.Sockets
Verbose + includehex），重启客户端后所有 HttpWebRequest 的 URL / 头 / 正文十六进制写入跟踪日志；
引擎按线程状态机关联 请求↔响应（Connection# / HttpWebRequest# / ConnectStream# 标识），
gzip 响应自动解包（多 member 容错）。日志与记录含真实 token（本机本地存储，不外传）。

## 本地代理模式（抓任意进程，Fiddler 式）

`lib/proxy-engine.mjs` 内置一个本地 HTTP(S) MITM 代理，任何程序把代理指向它
（或面板点「设为系统代理」），流量即实时入库（source=proxy）：

- **明文 HTTP**：直接记录；
- **HTTPS**：CONNECT + 按域名现场签发证书（本地生成根 CA，`proxy-certs\ca-cert.pem`），
  明文解密后记录；根证书经面板「安装根证书」一键导入当前用户信任（免管理员）；
- **上游代理链**：默认自动读取当前系统代理（WinINET）作为上游，所有连接经它出去，
  公司内网/代理环境下照常工作（`/proxy/start` 可用 `{upstream}` 覆盖，`null` 直连）；
- **系统代理一键切换**：「设为系统代理」把 WinINET 代理指向本代理并广播刷新，
  再点恢复原值（含 ProxyOverride）；
- 依赖 `node-forge`（生成证书），记录同 records.jsonl（body ≤ 2MB）；
- 边界：对目标站点的 TLS 校验关闭（抓包工具的常见取舍）。

### AutoResponder 规则引擎

规则存于 `proxy-rules.json`，经面板「代理规则」或 `/proxy/rules` 管理，对本地代理流量即时生效：

- **mock**：直接回包（状态码/头/体可配），不请求上游——伪造行情、mock 错误场景；
- **delay**：转发前等待 latencyMs——模拟慢网/慢接口，验证客户端超时与加载态；
- **block**：断开连接，不请求上游；
- **rewrite-status**：正常转发但改写响应状态码——验证客户端对错误码的容错。

匹配：方法 + 域名 + URL（包含/通配 `*`/正则），按顺序第一条命中生效；命中数持久化统计。
仅对 HTTP(S) 流量生效（不含 WebSocket）。

### WebSocket 抓取

代理对 `Upgrade: websocket` 同样接管（ws:// 直连代理、wss:// 走 CONNECT 隧道）：记录 101 握手、
双向帧统计（c2s 掩码 / s2c 明文，文本帧 utf-8 解码、分片重组、close 码）、收发字节与首字节耗时，
入库为 `method=WS` 的记录（reqBody=客户端首个文本消息，resBody=服务端文本累计，ws.frames 保留前 300 帧）。

### 面板扩展视图

- **瀑布图**：请求级时间轴（横条=总耗时，绿段=等待响应 TTFB，蓝段=传输），点击开详情；
- **重复检测**：同一「方法+路径」在 10s 窗口 ≥5 次即上榜（定时器风暴特征），点击行过滤该接口；
- **基线管理**：把当前筛选的接口契约（状态码/Content-Type/响应 JSON 字段结构）存为基线，
  之后一键对比新增/缺失端点与字段级变化；
- **定位源码**：详情抽屉按调用方归因（ViewModel/API 方法）在客户端源码中定位 .cs 定义，
  一键在 VS Code 打开（带行号）；源码根由环境变量 `DSH_API_SRC_ROOT` 指定（多根用 `;` 分隔），
  VS Code 可执行文件可用 `DSH_CODE_EXE` 指定（缺省探测常见安装路径，失败回退资源管理器定位）；
- **轮转日志**：把 %TEMP% 的跟踪/调用方日志改名归档并按保留期清理（捕获中自动先停再启）。

控制路由（loopback-only）：`POST /proxy/start {port,upstream}`、`POST /proxy/stop`、
`GET /proxy/status`、`GET /proxy/ca-cert.der`（证书下载）、`POST /proxy/install-ca`、
`POST /proxy/system-proxy {enable}`、`GET/POST/DELETE /proxy/rules`。
