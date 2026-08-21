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

## 使用方式

1. **重启 DSH**（插件注册与 client.js 加载在启动时生效），侧边栏出现「接口捕获」入口。
2. **实时捕获（Fiddler 式）**：面板里点「开始实时捕获」，宿主引擎开始 tail 客户端跟踪日志
   （默认 `%TEMP%\uiprobe-net-trace.log`），客户端流量实时流进列表（source=realtime）；
   点「停止实时捕获」暂停。要求客户端已注入 `system.diagnostics` 跟踪配置并重启过。
3. **agent 手动上报**：用 `api_capture_append` 工具追加记录（method/url 必填），同样实时显示。
4. **直接灌入**：`POST /api/dsh-api-visualizer/ingest`（body `{records:[...]}`，仅限本机回环）。

## API（host 侧，loopback-only）

- `GET  /api/dsh-api-visualizer/stats` — 总数/方法/状态/来源/域名分布
- `GET  /api/dsh-api-visualizer/records?limit&offset&q&method&source&status&includeBody` — 列表
- `GET  /api/dsh-api-visualizer/records/{id}` — 单条完整记录（含请求/响应体）
- `POST /api/dsh-api-visualizer/ingest` — 追加记录（单批 ≤ 500 条）
- `DELETE /api/dsh-api-visualizer/records` — 清空
- `POST /api/dsh-api-visualizer/capture/start` — 开始实时捕获（body 可选 `{logPath, replay}`）
- `POST /api/dsh-api-visualizer/capture/stop` — 停止实时捕获
- `GET  /api/dsh-api-visualizer/capture/status` — 引擎状态 + 实时入库计数

记录字段：`id, ts, source, process, method, url, status, durationMs, reqHeaders, reqBody, resHeaders, resBody, note`
（reqBody/resBody 每字段截断 ≤ 2MB，超出附 `…(截断)` 后缀）。

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
- 依赖 `node-forge`（生成证书），记录同 `records.jsonl`（body ≤ 2MB）；
- 边界：WebSocket 升级暂不解析（返回 502）；对目标站点的 TLS 校验关闭（抓包工具的常见取舍）。

控制路由（loopback-only）：`POST /proxy/start {port,upstream}`、`POST /proxy/stop`、
`GET /proxy/status`、`GET /proxy/ca-cert.der`（证书下载）、`POST /proxy/install-ca`、
`POST /proxy/system-proxy {enable}`。
