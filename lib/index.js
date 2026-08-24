/**
 * dsh-api-visualizer — host half.
 *
 * Mounts the JSONL capture store (records.jsonl under the dsh data dir),
 * the /api/dsh-api-visualizer route family (records / stats / ingest /
 * clear, loopback-only), the api_capture_append agent tool, and a
 * system-prompt announcement. The browser half (./client) renders the
 * 「接口捕获」 sidebar entry and live panel. Everything rides official DSH
 * packages — no dsh source changes.
 *
 * Record shape (one JSON object per line):
 *   { id, ts, source, process, method, url, status, durationMs,
 *     reqHeaders, reqBody, resHeaders, resBody, note }
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CaptureEngine, DEFAULT_LOG, DEFAULT_CALLER_LOG } from './capture-engine.mjs'
import { ProxyEngine } from './proxy-engine.mjs'

/** Stable cordis plugin name. */
export const name = 'api-visualizer'

/** Services required before the API surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Route family prefix. */
const API = '/api/dsh-api-visualizer'

/** Store cap: keep the newest records (rotation trims the head). */
const MAX_RECORDS = 20000
/** Max records per ingest call. */
const MAX_BATCH = 500
/** Cap on JSON request bodies (ingest batches can be sizable; 2MB per field). */
const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024
/** Per-field body cap: Fiddler-like full bodies for normal API payloads. */
const MAX_FIELD_BYTES = 2 * 1024 * 1024

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 140

/** Model-facing announcement: plugin presence, capabilities, and limits. */
const GUIDANCE =
  '本机已安装 dsh-api-visualizer 插件（DSH Web GUI 的接口捕获面板，Fiddler 式实时抓包）：侧边栏「接口捕获」入口，可视化展示 本机客户端进程 的 HTTP 接口调用。' +
  '能力：记录存本地 JSONL 库（按天分片 records-YYYYMMDD.jsonl，上限 20000 条）；面板内「开始实时捕获」按钮驱动宿主实时引擎，tail 客户端 System.Net 跟踪日志（%TEMP%\\uiprobe-net-trace.log，由客户端配置的 system.diagnostics 注入产生）自动解析出 方法/URL/状态/请求头/响应头/请求体/响应体（gzip 自动解包）并实时入库，source=realtime，并关联调用方归因（ViewModel/API/调用链，来自 %TEMP%\\uiprobe-caller.log）；' +
  '对应路由：POST /api/dsh-api-visualizer/capture/start（body 可选 {logPath, replay}）、POST /capture/stop、GET /capture/status、POST /capture/rotate（body {keepDays}，轮转 trace/caller 日志并清理过期 .bak，300MB 自动轮转）；' +
  'agent 工具：api_capture_append（追加记录）、api_capture_query（查询/过滤已捕获记录，支持 q/method/source/status/host/minDurationMs/errors/caller 等，返回调用方归因）；也可经 POST /api/dsh-api-visualizer/ingest 灌入。' +
  '本地代理模式（抓任意进程，Fiddler 式）：POST /proxy/start（body 可选 {port, upstream}，默认 8899、上游自动读系统代理）、POST /proxy/stop、GET /proxy/status、GET /proxy/ca-cert.der（根证书下载）、POST /proxy/install-ca（导入本机信任，免管理员）、POST /proxy/system-proxy（body {enable}，把系统代理指向本代理/恢复原值）；HTTPS 走 CONNECT + 按域签发证书解密，source=proxy；WebSocket 升级请求同样被抓取（帧统计+文本解码，source=proxy, method=WS）。' +
  'AutoResponder 规则引擎（对代理流量生效）：GET/POST/DELETE /proxy/rules（规则：方法/URL 匹配 + mock 响应/伪造状态码/注入延迟/阻断），用于模拟错误、mock 行情、验证客户端容错。' +
  '记录编辑：PATCH /records/{id}（body {note?, tag?, flag?}）；列表过滤支持 flag=1、host、Content-Type、耗时、响应字节、时间范围、body、sessionId、traceId；GET /stats/timeline 提供 P50/P95/P99 和吞吐趋势，GET /stats/sessions 提供会话聚合，GET /stats/repeats 检测高频重复请求（定时器风暴）。面板支持重放结果 JSON 差异、HAR/JSON/CSV/OpenAPI 契约导出、瀑布图、重复检测、基线/契约回归（POST /baseline/save、POST /baseline/diff）、调用方源码定位（POST /source/locate、POST /source/open，环境变量 DSH_API_SRC_ROOT 指向客户端源码根）。' +
  '限制：实时捕获依赖客户端已注入 system.diagnostics 跟踪配置（重启客户端后生效）；请求/响应体截断 ≤ 2MB；日志与记录含真实 token（本机本地存储，不外传，用户明确要求不脱敏）。' +
  '用户提到「接口可视化 / 抓接口 / 接口面板 / 接口捕获 / 实时抓包 / Fiddler」时即指本插件，请据此协作。'

/** Primary store location (env override, then ~/.dsh). */
function storeDir() {
  if (process.env.DSH_API_CAPTURE_STORE) return process.env.DSH_API_CAPTURE_STORE
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'api-capture')
}
const storeFile = (ts) => join(storeDir(), shardName(ts ?? Date.now()))

/** Day shard name for a record timestamp (local date). */
function shardName(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `records-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.jsonl`
}

/** All shard files: legacy single file first, then day shards ordered by name. */
function shardFiles() {
  const dir = storeDir()
  if (!existsSync(dir)) return []
  const out = []
  const legacy = join(dir, 'records.jsonl')
  if (existsSync(legacy)) out.push(legacy)
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names.sort()) {
    if (/^records-\d{8}\.jsonl$/.test(name)) out.push(join(dir, name))
  }
  return out
}

/** Normalize one raw record; returns null when it cannot form a record. */
function normalize(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : ''
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (method === '' || url === '') return null
  const rec = {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
    ts: Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    source: typeof raw.source === 'string' && raw.source !== '' ? raw.source : 'agent',
    method,
    url,
  }
  if (typeof raw.process === 'string' && raw.process !== '') rec.process = raw.process
  if (Number.isInteger(raw.status)) rec.status = raw.status
  if (Number.isFinite(raw.durationMs)) rec.durationMs = raw.durationMs
  if (typeof raw.reqHeaders === 'object' && raw.reqHeaders !== null) rec.reqHeaders = raw.reqHeaders
  if (typeof raw.reqBody === 'string') rec.reqBody = raw.reqBody.slice(0, MAX_FIELD_BYTES)
  if (typeof raw.resHeaders === 'object' && raw.resHeaders !== null) rec.resHeaders = raw.resHeaders
  if (typeof raw.resBody === 'string') rec.resBody = raw.resBody.slice(0, MAX_FIELD_BYTES)
  if (typeof raw.note === 'string' && raw.note !== '') rec.note = raw.note
  if (typeof raw.contentType === 'string' && raw.contentType !== '') rec.contentType = raw.contentType
  if (Number.isFinite(raw.firstByteMs)) rec.firstByteMs = raw.firstByteMs
  if (Number.isFinite(raw.ttfbMs)) rec.ttfbMs = raw.ttfbMs
  if (Number.isFinite(raw.connectMs)) rec.connectMs = raw.connectMs
  if (Number.isFinite(raw.tlsMs)) rec.tlsMs = raw.tlsMs
  if (typeof raw.ruleId === 'string' && raw.ruleId !== '') rec.ruleId = raw.ruleId
  if (typeof raw.ws === 'object' && raw.ws !== null) rec.ws = raw.ws
  if (Number.isFinite(raw.bytesReq)) rec.bytesReq = raw.bytesReq
  if (Number.isFinite(raw.bytesRes)) rec.bytesRes = raw.bytesRes
  if (Number.isInteger(raw.chunkCount)) rec.chunkCount = raw.chunkCount
  if (typeof raw.complete === 'boolean') rec.complete = raw.complete
  if (typeof raw.streaming === 'boolean') rec.streaming = raw.streaming
  if (typeof raw.sessionId === 'string' && raw.sessionId !== '') rec.sessionId = raw.sessionId
  if (typeof raw.traceId === 'string' && raw.traceId !== '') rec.traceId = raw.traceId
  if (typeof raw.parentId === 'string' && raw.parentId !== '') rec.parentId = raw.parentId
  if (typeof raw.caller === 'object' && raw.caller !== null) rec.caller = raw.caller
  if (typeof raw.tag === 'string' && raw.tag !== '') rec.tag = raw.tag
  if (raw.flag === 1 || raw.flag === true) rec.flag = 1
  return rec
}

/** Parse the JSONL store into records (newest last); deduped by id, last occurrence wins. */
let storeCache = { key: null, records: [] }
let duplicateAppendsSinceCompact = 0

function storeKey(files) {
  let mtime = 0
  let size = 0
  for (const file of files) {
    try {
      const st = statSync(file)
      if (st.mtimeMs > mtime) mtime = st.mtimeMs
      size += st.size
    } catch {
      // file may vanish between list and stat
    }
  }
  return `${mtime}:${size}:${files.length}`
}

function invalidateStoreCache() {
  storeCache = { key: null, records: [] }
}

function readAll() {
  const files = shardFiles()
  const key = storeKey(files)
  if (storeCache.key === key) return storeCache.records
  const byId = new Map()
  const order = []
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t === '') continue
      try {
        const record = JSON.parse(t)
        if (record && typeof record.id === 'string') {
          if (!byId.has(record.id)) order.push(record.id)
          byId.set(record.id, record)
        }
      } catch {
        // skip malformed lines (manual edits, concurrent writers)
      }
    }
  }
  const out = order.map((id) => byId.get(id)).filter((record) => record !== undefined)
  storeCache = { key, records: out }
  return out
}

/** Append normalized records into day shards (grouped by each record's own ts). */
function appendToShards(records) {
  if (records.length === 0) return
  mkdirSync(storeDir(), { recursive: true })
  const byFile = new Map()
  for (const rec of records) {
    const file = join(storeDir(), shardName(rec.ts))
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(rec)
  }
  for (const [file, list] of byFile) {
    appendFileSync(file, list.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  }
}

/** Migrate the legacy single-file store into day shards (once per process). */
let legacyMigrated = false
function migrateLegacy() {
  if (legacyMigrated) return
  legacyMigrated = true
  const legacy = join(storeDir(), 'records.jsonl')
  if (!existsSync(legacy)) return
  const recs = []
  for (const line of readFileSync(legacy, 'utf8').split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try {
      const r = JSON.parse(t)
      if (r && typeof r.id === 'string') recs.push(r)
    } catch {
      // skip
    }
  }
  try {
    rmSync(legacy, { force: true })
  } catch {
    // keep legacy as read-only archive if it cannot be removed
  }
  if (recs.length > 0) appendToShards(recs)
}

/** Rewrite the whole store: drop every shard, then write records grouped by day. */
function persistAll(records) {
  const dir = storeDir()
  if (!existsSync(dir)) {
    if (records.length === 0) return
    mkdirSync(dir, { recursive: true })
  } else {
    try {
      const legacy = join(dir, 'records.jsonl')
      if (existsSync(legacy)) rmSync(legacy, { force: true })
      for (const name of readdirSync(dir)) {
        if (/^records-\d{8}\.jsonl$/.test(name)) rmSync(join(dir, name), { force: true })
      }
    } catch {
      // best effort; append below may still succeed
    }
  }
  appendToShards(records)
  duplicateAppendsSinceCompact = 0
  invalidateStoreCache()
}

/** Append normalized records; enforce the global newest-N cap across shards. */
function appendRecords(rawRecords) {
  migrateLegacy()
  const records = []
  for (const raw of rawRecords) {
    const rec = normalize(raw)
    if (rec !== null) records.push(rec)
  }
  if (records.length === 0) return { ingested: 0, total: readAll().length }
  const existingIds = new Set(readAll().map((record) => record.id))
  const seenIds = new Set(existingIds)
  for (const record of records) {
    if (seenIds.has(record.id)) duplicateAppendsSinceCompact += 1
    seenIds.add(record.id)
  }
  appendToShards(records)
  invalidateStoreCache()
  let all = readAll()
  let physicalBytes = 0
  for (const file of shardFiles()) {
    try { physicalBytes += statSync(file).size } catch { /* file may rotate between list/stat */ }
  }
  if (all.length > MAX_RECORDS || duplicateAppendsSinceCompact >= 200 || physicalBytes > 128 * 1024 * 1024) {
    all = all.slice(all.length - MAX_RECORDS)
    persistAll(all)
    all = readAll()
  }
  return { ingested: records.length, total: all.length }
}

/** Drop every record (all shards). */
function clearRecords() {
  const all = readAll()
  for (const file of shardFiles()) {
    try {
      rmSync(file, { force: true })
    } catch {
      // best effort
    }
  }
  duplicateAppendsSinceCompact = 0
  invalidateStoreCache()
  return { cleared: all.length }
}

/** Store API, exported for capture backends and tests. */
export { storeDir, storeFile, readAll, appendRecords, clearRecords }

/** Strip bodies + ws frames from list payloads (keep the table light). */
function withoutBodies(records) {
  return records.map((r) => {
    const { reqBody, resBody, ws, ...rest } = r
    return rest
  })
}

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh's fence). */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read and parse a JSON request body with a size cap. */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`body too large (> ${maxBytes} bytes)`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Hostname of a record url, or ''. */
function hostOf(rec) {
  try {
    return new URL(rec.url).hostname
  } catch {
    return ''
  }
}

function headerValue(headers, name) {
  const key = Object.keys(headers ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : headers[key]
}

function sessionKeyOf(rec) {
  const caller = rec.caller ?? {}
  return rec.sessionId || rec.traceId || `${rec.source ?? ''}|${rec.process ?? ''}|${caller.viewModel ?? caller.view ?? ''}|${Math.floor((Number(rec.ts) || 0) / 10000)}`
}

/** Static-resource / heartbeat noise patterns (hide-no-noise filter). */
const NOISE_PATTERNS = [
  /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|map)([?#]|$)/i,
  /(heart|ping|beacon|favicon)/i,
  /buryingpoint/i,
]

/**
 * Shared filter pipeline for GET /records and DELETE /records?filtered=1.
 * Params: q, regex, method, source, status, flag, host (comma list),
 * contentType (comma list, substring), minDurationMs, minBytes, maxBytes,
 * fromTs, toTs, sessionId, traceId, errors, noNoise, bodyQ.
 */
function applyFilters(all, params) {
  const q = (params.get('q') ?? '').trim()
  const regexMode = params.get('regex') === '1'
  let re = null
  if (q !== '') {
    if (regexMode) {
      try {
        re = new RegExp(q, 'i')
      } catch {
        re = null
      }
    }
  }
  const methodFilter = (params.get('method') ?? '').toUpperCase()
  const sourceFilter = (params.get('source') ?? '').trim()
  const statusFilter = (params.get('status') ?? '').trim()
  const normalizedStatus = statusFilter.toLowerCase()
  const hostFilter = (params.get('host') ?? '').trim().toLowerCase()
  const ctFilter = (params.get('contentType') ?? '').trim().toLowerCase()
  const minDurRaw = params.get('minDurationMs')
  const minDur = minDurRaw === null || minDurRaw === '' ? null : Number(minDurRaw)
  const minBytesRaw = params.get('minBytes')
  const minBytes = minBytesRaw === null || minBytesRaw === '' ? null : Number(minBytesRaw)
  const maxBytesRaw = params.get('maxBytes')
  const maxBytes = maxBytesRaw === null || maxBytesRaw === '' ? null : Number(maxBytesRaw)
  const fromRaw = params.get('fromTs')
  const toRaw = params.get('toTs')
  const fromTs = fromRaw === null || fromRaw === '' ? null : Number(fromRaw)
  const toTs = toRaw === null || toRaw === '' ? null : Number(toRaw)
  const sessionId = (params.get('sessionId') ?? '').trim()
  const traceId = (params.get('traceId') ?? '').trim()
  const errorsOnly = params.get('errors') === '1'
  const noNoise = params.get('noNoise') === '1'
  const bodyQ = (params.get('bodyQ') ?? '').trim().toLowerCase()

  let items = all
  if (q !== '') {
    if (re !== null) {
      items = items.filter((r) => re.test(r.url) || (typeof r.note === 'string' && re.test(r.note)))
    } else {
      const lq = q.toLowerCase()
      items = items.filter((r) => r.url.toLowerCase().includes(lq) || (typeof r.note === 'string' && r.note.toLowerCase().includes(lq)))
    }
  }
  if (methodFilter !== '' && methodFilter !== 'ALL') items = items.filter((r) => r.method === methodFilter)
  if (sourceFilter !== '' && sourceFilter !== 'all') items = items.filter((r) => (r.source ?? '') === sourceFilter)
  if (statusFilter !== '') {
    items = normalizedStatus.endsWith('xx')
      ? items.filter((r) => Number.isInteger(r.status) && Math.floor(r.status / 100) === Number(normalizedStatus[0]))
      : items.filter((r) => String(r.status) === statusFilter)
  }
  if (params.get('flag') === '1') items = items.filter((r) => r.flag === true || r.flag === 1)
  if (hostFilter !== '') {
    const hosts = hostFilter.split(',').map((h) => h.trim()).filter((h) => h !== '')
    items = items.filter((r) => hosts.includes(hostOf(r)))
  }
  if (ctFilter !== '') {
    const cts = ctFilter.split(',').map((c) => c.trim()).filter((c) => c !== '')
    items = items.filter((r) => {
      const ct = String(headerValue(r.resHeaders, 'content-type') ?? r.contentType ?? '').toLowerCase()
      return cts.some((c) => ct.includes(c))
    })
  }
  if (minDur !== null && Number.isFinite(minDur)) items = items.filter((r) => Number.isFinite(r.durationMs) && r.durationMs >= minDur)
  if (minBytes !== null && Number.isFinite(minBytes)) items = items.filter((r) => (Number(r.bytesRes) || 0) >= minBytes)
  if (maxBytes !== null && Number.isFinite(maxBytes)) items = items.filter((r) => (Number(r.bytesRes) || 0) <= maxBytes)
  if (Number.isFinite(fromTs)) items = items.filter((r) => Number(r.ts) >= fromTs)
  if (Number.isFinite(toTs)) items = items.filter((r) => Number(r.ts) <= toTs)
  if (sessionId !== '') items = items.filter((r) => sessionKeyOf(r) === sessionId)
  if (traceId !== '') items = items.filter((r) => r.traceId === traceId)
  if (errorsOnly) items = items.filter((r) => Number.isInteger(r.status) && r.status >= 400)
  if (noNoise) items = items.filter((r) => !NOISE_PATTERNS.some((p) => p.test(r.url)))
  if (bodyQ !== '') {
    items = items.filter((r) => {
      const hay = `${typeof r.reqBody === 'string' ? r.reqBody : ''}\n${typeof r.resBody === 'string' ? r.resBody : ''}\n${JSON.stringify(r.reqHeaders ?? {})}\n${JSON.stringify(r.resHeaders ?? {})}`.toLowerCase()
      return hay.includes(bodyQ)
    })
  }
  return items
}

/** Method+path key of a record (endpoint aggregation). */
function endpointKeyOf(rec) {
  let pathname
  try {
    pathname = new URL(rec.url).pathname
  } catch {
    pathname = String(rec.url).split('?')[0]
  }
  return `${rec.method} ${pathname}`
}

/** Flatten a JSON value into dotted "path:type" shape entries (contract fingerprint). */
function jsonShape(value, depth = 0) {
  const out = []
  if (depth > 7) return out
  if (Array.isArray(value)) {
    if (value.length > 0) {
      for (const p of jsonShape(value[0], depth + 1)) out.push(`[]${p === '' ? '' : '.' + p}`)
    }
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      const v = value[key]
      const child = jsonShape(v, depth + 1)
      if (child.length === 0) {
        out.push(`${key}:${Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v}`)
      } else {
        for (const p of child) out.push(`${key}.${p}`)
      }
    }
    return out
  }
  return []
}

/** Contract fingerprint of one endpoint from its records (status, content-type, response shape). */
function endpointContract(records) {
  const statuses = new Set()
  const contentTypes = new Set()
  const shape = new Set()
  for (const r of records) {
    if (Number.isInteger(r.status)) statuses.add(r.status)
    const ct = String(headerValue(r.resHeaders, 'content-type') ?? r.contentType ?? '').split(';')[0].trim().toLowerCase()
    if (ct !== '') contentTypes.add(ct)
    if (typeof r.resBody === 'string' && r.resBody !== '') {
      try {
        for (const p of jsonShape(JSON.parse(r.resBody))) shape.add(p)
      } catch {
        // non-JSON body: no shape
      }
    }
  }
  return { statuses: [...statuses].sort(), contentTypes: [...contentTypes].sort(), shape: [...shape].sort() }
}

/** Aggregate current store into endpoint contracts (baseline building block). */
function buildContracts(all) {
  const byKey = new Map()
  for (const r of all) {
    const key = endpointKeyOf(r)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }
  const out = {}
  for (const [key, recs] of byKey) out[key] = endpointContract(recs)
  return out
}

// ---------------------------------------------------------------- baselines

function baselineDir() {
  return join(storeDir(), 'baselines')
}

function baselineFile(name) {
  const safe = String(name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)
  return join(baselineDir(), `${safe}.json`)
}

function listBaselines() {
  const dir = baselineDir()
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const b = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (b && typeof b.name === 'string') out.push({ name: b.name, savedAt: b.savedAt ?? null, endpoints: Object.keys(b.endpoints ?? {}).length, records: b.records ?? 0 })
    } catch {
      // skip corrupt baseline
    }
  }
  return out.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
}

function readBaseline(name) {
  const file = baselineFile(name)
  if (!existsSync(file)) return null
  try {
    const b = JSON.parse(readFileSync(file, 'utf8'))
    return b && typeof b.name === 'string' ? b : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- source locate

function srcRoots() {
  const env = process.env.DSH_API_SRC_ROOT ?? process.env.DSH_HANG_SRC_ROOT
  if (typeof env === 'string' && env.trim() !== '') {
    return env.split(';').map((p) => p.trim()).filter((p) => p !== '' && existsSync(p))
  }
  return []
}

const sourceSearchCache = new Map() // key -> {files, at}

/** Locate .cs files defining the given type / method under the source roots (bounded two-stage scan). */
function searchSource({ vm, api }) {
  const roots = srcRoots()
  if (roots.length === 0) {
    return { files: [], roots: [], searched: 0, hint: 'set DSH_API_SRC_ROOT to the client source root (multiple roots separated by ;)' }
  }
  const apiType = typeof api === 'string' && api.includes('.') ? api.split('.')[0] : ''
  const apiMethod = typeof api === 'string' && api.includes('.') ? api.slice(api.lastIndexOf('.') + 1) : ''
  const key = `${roots.join(';')}|${vm ?? ''}|${apiType ?? ''}|${apiMethod ?? ''}`
  const cached = sourceSearchCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < 30000) return cached.value
  const needleVms = typeof vm === 'string' && vm !== '' ? [vm, ...(vm.endsWith('ViewModel') ? [vm.slice(0, -9)] : [])] : []
  const needleApi = apiType !== '' ? [apiType] : []
  const needleNames = [...needleVms, ...needleApi]

  // Stage 0: walk the tree and collect candidate .cs paths (no file reads).
  const csFiles = []
  const stack = [...roots]
  while (stack.length > 0 && csFiles.length < 40000) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['bin', 'obj', '.git', '.vs', 'node_modules', 'packages', 'packages-api'].includes(entry.name.toLowerCase())) continue
        stack.push(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.cs')) csFiles.push(full)
    }
  }
  const hits = []
  const pushHit = (path, what, line) => {
    if (!hits.some((h) => h.path === path)) hits.push({ path, matches: [{ what, line }] })
    else hits.find((h) => h.path === path).matches.push({ what, line })
  }

  // Stage 1: filename equals the type name (C# convention) — cheap and usually decisive.
  const rest = []
  for (const file of csFiles) {
    const base = file.slice(file.lastIndexOf('\\') + 1, -3)
    if (needleNames.includes(base)) {
      try {
        const text = readFileSync(file, 'utf8')
        const needle = needleVms.includes(base) ? `class ${base}` : base
        const idx = text.split('\n').findIndex((l) => l.includes(needle))
        pushHit(file, needle, idx >= 0 ? idx + 1 : 1)
      } catch {
        // unreadable
      }
    } else {
      rest.push(file)
    }
  }

  // Stage 2: content scan (only when filename hits are sparse).
  let searched = 0
  if (hits.length < 12) {
    for (const file of rest) {
      if (hits.length >= 30 || searched >= 5000) break
      searched++
      let text = null
      const need = (read) => {
        if (text === null) text = read
        const lines = text.split('\n')
        const found = []
        for (const nv of needleVms) {
          const idx = lines.findIndex((l) => l.includes(`class ${nv}`))
          if (idx >= 0) found.push({ what: `class ${nv}`, line: idx + 1 })
        }
        if (found.length === 0) {
          for (const na of needleApi) {
            if (lines.some((l) => l.includes(`class ${na}`))) {
              const needleLine = apiMethod !== '' ? apiMethod : `class ${na}`
              const idx = lines.findIndex((l) => l.includes(needleLine))
              found.push({ what: `class ${na}` + (apiMethod !== '' ? `.${apiMethod}` : ''), line: idx >= 0 ? idx + 1 : 1 })
            }
          }
        }
        return found
      }
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        continue
      }
      if (size > 2 * 1024 * 1024) continue
      try {
        const found = need(readFileSync(file, 'utf8'))
        if (found.length > 0) pushHit(file, found[0].what, found[0].line)
      } catch {
        // unreadable
      }
    }
  }
  hits.sort((a, b) => {
    const rank = (h) => (h.matches.some((m) => m.what.startsWith('class') && needleVms.includes(m.what.slice(6))) ? 0 : 1)
    return rank(a) - rank(b)
  })
  const value = { files: hits, roots, searched: searched + (csFiles.length - rest.length) }
  sourceSearchCache.set(key, { value, at: Date.now() })
  return value
}

/** Build the route family. */
function makeRoutes(capture, proxy) {
  return [
    {
      kind: 'prefix',
      path: API,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        const method = req.method ?? 'GET'
        const url = new URL(req.url ?? '/', 'http://localhost')
        const pathname = url.pathname
        const rest = pathname.startsWith(API) ? pathname.slice(API.length) : pathname
        const params = url.searchParams

        // GET / — probe
        if (method === 'GET' && (rest === '' || rest === '/')) {
          writeJson(res, 200, { name: 'dsh-api-visualizer', api: API, ok: true })
          return
        }

        // GET /stats — counters for the panel chips
        if (method === 'GET' && rest === '/stats') {
          const all = readAll()
          const byMethod = {}
          const bySource = {}
          const byStatus = {}
          const byHost = {}
          for (const r of all) {
            byMethod[r.method] = (byMethod[r.method] ?? 0) + 1
            bySource[r.source] = (bySource[r.source] ?? 0) + 1
            const status = r.status
            const bucket = Number.isInteger(status) ? `${Math.floor(status / 100)}xx` : '-'
            byStatus[bucket] = (byStatus[bucket] ?? 0) + 1
            let host = '-'
            try {
              host = new URL(r.url).hostname
            } catch {
              // relative or malformed url
            }
            byHost[host] = (byHost[host] ?? 0) + 1
          }
          writeJson(res, 200, {
            total: all.length,
            lastTs: all.length > 0 ? all[all.length - 1].ts : null,
            storeFile: storeFile(),
            byMethod,
            bySource,
            byStatus,
            byHost,
          })
          return
        }

        // GET /records?limit&offset&cursor&q&regex&method&source&status&flag&host&contentType&minDurationMs&minBytes&maxBytes&fromTs&toTs&sessionId&traceId&errors&noNoise&bodyQ&includeBody
        if (method === 'GET' && rest === '/records') {
          const all = readAll()
          const includeBody = params.get('includeBody') === '1'
          const limitRaw = Number(params.get('limit'))
          const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 200, 1), 2000)
          const offsetRaw = Number(params.get('offset'))
          const offset = Math.max(Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0, 0)
          let items = applyFilters(all, params)
          const cursor = params.get('cursor')
          if (cursor !== null && cursor !== '') {
            const [tsText, id] = cursor.split('|')
            const ts = Number(tsText)
            if (Number.isFinite(ts)) items = items.filter((r) => Number(r.ts) < ts || (Number(r.ts) === ts && String(r.id) < String(id ?? '')))
          }
          const total = items.length
          const page = items.slice(Math.max(items.length - offset - limit, 0), Math.max(items.length - offset, 0))
          page.reverse()
          const oldest = page.length > 0 ? page[page.length - 1] : null
          const nextCursor = oldest !== null ? `${oldest.ts}|${oldest.id}` : null
          writeJson(res, 200, { total, items: includeBody ? page : withoutBodies(page), nextCursor, hasMore: items.length > offset + page.length })
          return
        }

        // GET /stats/endpoints — aggregate by method + path (P1 observability)
        if (method === 'GET' && rest === '/stats/endpoints') {
          const all = applyFilters(readAll(), params)
          const byKey = new Map()
          for (const r of all) {
            let pathname
            try {
              pathname = new URL(r.url).pathname
            } catch {
              pathname = r.url.split('?')[0]
            }
            const key = `${r.method} ${pathname}`
            let e = byKey.get(key)
            if (e === undefined) {
              e = { method: r.method, path: pathname, count: 0, errors: 0, durs: [], lastTs: 0, lastStatus: null, sampleUrl: r.url }
              byKey.set(key, e)
            }
            e.count += 1
            if (Number.isInteger(r.status) && r.status >= 400) e.errors += 1
            if (Number.isFinite(r.durationMs)) e.durs.push(r.durationMs)
            if ((r.ts ?? 0) > e.lastTs) {
              e.lastTs = r.ts ?? 0
              e.lastStatus = r.status
            }
          }
          const items = [...byKey.values()].map((e) => {
            e.durs.sort((a, b) => a - b)
            const q = (p) => (e.durs.length > 0 ? e.durs[Math.min(e.durs.length - 1, Math.floor(e.durs.length * p))] : null)
            return {
              method: e.method,
              path: e.path,
              count: e.count,
              errors: e.errors,
              errorRate: e.count > 0 ? Number((e.errors / e.count).toFixed(3)) : 0,
              avgMs: e.durs.length > 0 ? Math.round(e.durs.reduce((a, b) => a + b, 0) / e.durs.length) : null,
              p95Ms: q(0.95),
              maxMs: e.durs.length > 0 ? e.durs[e.durs.length - 1] : null,
              lastTs: e.lastTs,
              lastStatus: e.lastStatus,
              sampleUrl: e.sampleUrl,
            }
          })
          items.sort((a, b) => b.count - a.count)
          writeJson(res, 200, { total: items.length, items })
          return
        }

        // GET /stats/timeline — time-bucketed request/error/latency/bytes trend.
        if (method === 'GET' && rest === '/stats/timeline') {
          const bucketMs = Math.max(1000, Math.min(Number(params.get('bucketMs') ?? 60000) || 60000, 86400000))
          const filtered = applyFilters(readAll(), params)
          const buckets = new Map()
          for (const r of filtered) {
            const ts = Number(r.ts)
            if (!Number.isFinite(ts)) continue
            const start = Math.floor(ts / bucketMs) * bucketMs
            let bucket = buckets.get(start)
            if (bucket === undefined) {
              bucket = { start, count: 0, errors: 0, bytesRes: 0, durations: [] }
              buckets.set(start, bucket)
            }
            bucket.count += 1
            if (Number.isInteger(r.status) && r.status >= 400) bucket.errors += 1
            bucket.bytesRes += Number(r.bytesRes) || 0
            if (Number.isFinite(r.durationMs)) bucket.durations.push(r.durationMs)
          }
          const items = [...buckets.values()].sort((a, b) => a.start - b.start).map((b) => {
            b.durations.sort((a, c) => a - c)
            const percentile = (p) => b.durations.length === 0 ? null : b.durations[Math.min(b.durations.length - 1, Math.floor(b.durations.length * p))]
            return { start: b.start, end: b.start + bucketMs, count: b.count, errors: b.errors, errorRate: b.count === 0 ? 0 : Number((b.errors / b.count).toFixed(3)), bytesRes: b.bytesRes, avgMs: b.durations.length === 0 ? null : Math.round(b.durations.reduce((a, c) => a + c, 0) / b.durations.length), p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }
          })
          writeJson(res, 200, { bucketMs, total: items.length, items })
          return
        }

        // GET /stats/sessions — group by explicit session/trace, then caller/time fallback.
        if (method === 'GET' && rest === '/stats/sessions') {
          const groups = new Map()
          for (const r of applyFilters(readAll(), params)) {
            const key = sessionKeyOf(r)
            let group = groups.get(key)
            if (group === undefined) {
              group = { sessionId: key, explicit: Boolean(r.sessionId || r.traceId), firstTs: r.ts ?? 0, lastTs: r.ts ?? 0, count: 0, errors: 0, bytesRes: 0, methods: {}, hosts: {}, records: [] }
              groups.set(key, group)
            }
            group.firstTs = Math.min(group.firstTs, r.ts ?? group.firstTs)
            group.lastTs = Math.max(group.lastTs, r.ts ?? group.lastTs)
            group.count += 1
            if (Number.isInteger(r.status) && r.status >= 400) group.errors += 1
            group.bytesRes += Number(r.bytesRes) || 0
            group.methods[r.method] = (group.methods[r.method] ?? 0) + 1
            const host = hostOf(r) || '-'
            group.hosts[host] = (group.hosts[host] ?? 0) + 1
            if (group.records.length < 20) group.records.push({ id: r.id, ts: r.ts, method: r.method, url: r.url, status: r.status })
          }
          const items = [...groups.values()].sort((a, b) => b.lastTs - a.lastTs)
          writeJson(res, 200, { total: items.length, items })
          return
        }

        // GET /records/{id} — full record incl. bodies
        const idMatch = rest.match(/^\/records\/([^/]+)$/)
        if (method === 'GET' && idMatch !== null) {
          const id = decodeURIComponent(idMatch[1])
          const found = readAll().find((r) => r.id === id)
          if (found === undefined) {
            writeJson(res, 404, { error: 'record not found' })
            return
          }
          writeJson(res, 200, found)
          return
        }

        // PATCH /records/{id} — update note / tag / flag
        if (method === 'PATCH' && idMatch !== null) {
          const id = decodeURIComponent(idMatch[1])
          let patch
          try {
            patch = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch (error) {
            writeJson(res, 400, { error: `invalid JSON body: ${error instanceof Error ? error.message : String(error)}` })
            return
          }
          const all = readAll()
          const idx = all.findIndex((r) => r.id === id)
          if (idx === -1) {
            writeJson(res, 404, { error: 'record not found' })
            return
          }
          const rec = all[idx]
          if (typeof patch.note === 'string') {
            if (patch.note === '') delete rec.note
            else rec.note = patch.note
          }
          if (typeof patch.tag === 'string') {
            if (patch.tag === '') delete rec.tag
            else rec.tag = patch.tag
          }
          if (typeof patch.flag === 'boolean') {
            if (patch.flag) rec.flag = true
            else delete rec.flag
          }
          persistAll(all)
          writeJson(res, 200, rec)
          return
        }

        // POST /ingest — append a batch { records: [...] }
        if (method === 'POST' && rest === '/ingest') {
          let body
          try {
            body = await readJsonBody(req, MAX_JSON_BODY_BYTES)
          } catch (error) {
            writeJson(res, 400, { error: `invalid JSON body: ${error instanceof Error ? error.message : String(error)}` })
            return
          }
          const raw = Array.isArray(body) ? body : body?.records
          if (!Array.isArray(raw)) {
            writeJson(res, 400, { error: 'expected { records: [...] } or an array' })
            return
          }
          if (raw.length > MAX_BATCH) {
            writeJson(res, 400, { error: `batch too large (> ${MAX_BATCH})` })
            return
          }
          const result = appendRecords(raw)
          writeJson(res, 200, result)
          return
        }

        // DELETE /records/{id} — remove one record
        if (method === 'DELETE' && idMatch !== null) {
          const id = decodeURIComponent(idMatch[1])
          const all = readAll()
          const kept = all.filter((r) => r.id !== id)
          if (kept.length === all.length) {
            writeJson(res, 404, { error: 'record not found' })
            return
          }
          persistAll(kept)
          writeJson(res, 200, { deleted: all.length - kept.length })
          return
        }

        // DELETE /records — clear the store, or ?filtered=1 to delete the current filter set
        if (method === 'DELETE' && rest === '/records') {
          if (params.get('filtered') === '1') {
            const all = readAll()
            const matched = applyFilters(all, params)
            if (matched.length === 0) {
              writeJson(res, 200, { deleted: 0 })
              return
            }
            const ids = new Set(matched.map((r) => r.id))
            persistAll(all.filter((r) => !ids.has(r.id)))
            writeJson(res, 200, { deleted: matched.length })
            return
          }
          writeJson(res, 200, clearRecords())
          return
        }

        // GET /capture/status — realtime engine state + store counters
        if (method === 'GET' && rest === '/capture/status') {
          const all = readAll()
          writeJson(res, 200, {
            ...capture.status(),
            managed: true,
            storeTotal: all.length,
            storeRealtime: all.filter((r) => (r.source ?? '') === 'realtime').length,
          })
          return
        }

        // POST /capture/start { logPath?, replay? } — begin Fiddler-style live capture
        if (method === 'POST' && rest === '/capture/start') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          if (typeof body.logPath === 'string' && body.logPath.trim() !== '') {
            capture.setLogPath(body.logPath.trim())
          }
          capture.start({ replay: body.replay === true })
          writeJson(res, 200, { ...capture.status(), managed: true })
          return
        }

        // POST /capture/stop — stop live capture
        if (method === 'POST' && rest === '/capture/stop') {
          capture.stop()
          writeJson(res, 200, { ...capture.status(), managed: true })
          return
        }

        // GET /proxy/status — local MITM proxy state
        if (method === 'GET' && rest === '/proxy/status') {
          writeJson(res, 200, { ...proxy.status(), managed: true })
          return
        }

        // POST /proxy/start { port?, upstream? } — start the local proxy
        if (method === 'POST' && rest === '/proxy/start') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const status = proxy.start({
              port: Number.isInteger(body.port) && body.port > 0 && body.port < 65536 ? body.port : 8899,
              upstream: typeof body.upstream === 'string' ? body.upstream : undefined,
            })
            writeJson(res, 200, { ...status, managed: true })
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        // POST /proxy/stop
        if (method === 'POST' && rest === '/proxy/stop') {
          writeJson(res, 200, { ...proxy.stop(), managed: true })
          return
        }

        // GET /proxy/ca-cert.der — root CA download (loopback only)
        if (method === 'GET' && rest === '/proxy/ca-cert.der') {
          try {
            const derPath = proxy.caCertDerPath()
            res.writeHead(200, {
              'content-type': 'application/x-x509-ca-cert',
              'content-disposition': 'attachment; filename="dsh-api-visualizer-ca.der"',
            })
            const { createReadStream } = await import('node:fs')
            createReadStream(derPath).pipe(res)
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        // POST /proxy/install-ca — import the CA into CurrentUser\Root
        if (method === 'POST' && rest === '/proxy/install-ca') {
          try {
            writeJson(res, 200, await proxy.installCa())
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        // POST /proxy/system-proxy { enable } — point/restore the WinINET system proxy
        if (method === 'POST' && rest === '/proxy/system-proxy') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const result = await proxy.setSystemProxy(body.enable === true)
            writeJson(res, 200, { ...result, managed: true })
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        // POST /logs/clear — run the bundled cleanup script (trace log + capture-dir logs)
        if (method === 'POST' && rest === '/logs/clear') {
          const script = fileURLToPath(new URL('./scripts/clean-capture-logs.ps1', import.meta.url))
          const traceLog = join(process.env.TEMP || process.env.TMP || '', 'uiprobe-net-trace.log')
          const traceBefore = existsSync(traceLog)
          const run = await new Promise((resolve) => {
            execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-TraceLog', traceLog, '-LogDir', storeDir()], { timeout: 60000, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
              resolve({ ok: error === null, output: (stdout ?? '').trim().slice(0, 400), err: error ? String(error.message ?? error).slice(0, 200) : null })
            })
          })
          const traceAfter = existsSync(traceLog)
          writeJson(res, 200, {
            ...run,
            traceLogDeleted: traceBefore && !traceAfter,
            traceLogSkipped: traceBefore && traceAfter,
            hint: traceBefore && traceAfter ? '客户端正在运行，跟踪日志被占用未删除（重启客户端后可清除）' : '',
          })
          return
        }

        // GET /stats/repeats — burst/repeated-request detection (timer-storm finder)
        if (method === 'GET' && rest === '/stats/repeats') {
          const windowMs = Math.max(500, Math.min(Number(params.get('windowMs') ?? 10000) || 10000, 3600000))
          const minCount = Math.max(2, Math.min(Number(params.get('minCount') ?? 5) || 5, 100000))
          const all = applyFilters(readAll(), params)
          const byKey = new Map()
          for (const r of all) {
            const key = endpointKeyOf(r)
            if (!byKey.has(key)) byKey.set(key, [])
            byKey.get(key).push(r)
          }
          const items = []
          for (const [key, recs] of byKey) {
            const times = recs.map((r) => Number(r.ts)).filter(Number.isFinite).sort((a, b) => a - b)
            if (times.length < minCount) continue
            let maxInWindow = 0
            let left = 0
            for (let right = 0; right < times.length; right++) {
              while (times[right] - times[left] > windowMs) left++
              maxInWindow = Math.max(maxInWindow, right - left + 1)
            }
            if (maxInWindow < minCount) continue
            const last = recs.slice().sort((a, b) => Number(b.ts) - Number(a.ts))[0] ?? {}
            const caller = last.caller ?? {}
            items.push({
              method: recs[0].method,
              path: key.slice(recs[0].method.length + 1),
              count: times.length,
              firstTs: times[0],
              lastTs: times[times.length - 1],
              windowMs,
              maxInWindow,
               peakRatePerMin: windowMs > 0 ? Number(((maxInWindow * 60000) / windowMs).toFixed(1)) : null,
              caller: [caller.viewModel, caller.apiMethod].filter(Boolean).join(' ← ') || null,
              lastStatus: last.status,
              lastUrl: last.url,
            })
          }
          items.sort((a, b) => b.maxInWindow - a.maxInWindow)
          writeJson(res, 200, { windowMs, minCount, total: items.length, items })
          return
        }

        // GET /baseline/list — saved contract baselines
        if (method === 'GET' && rest === '/baseline/list') {
          writeJson(res, 200, { total: listBaselines().length, items: listBaselines() })
          return
        }

        // POST /baseline/save { name, filter? } — snapshot endpoint contracts under the filter
        if (method === 'POST' && rest === '/baseline/save') {
          let body = {}
          try {
            body = (await readJsonBody(req, 256 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const name = String(body.name ?? '').trim()
          if (name === '') {
            writeJson(res, 400, { error: 'name required' })
            return
          }
          const filtered = applyFilters(readAll(), paramsFromObj(body.filter ?? {}))
          const baseline = {
            name,
            savedAt: Date.now(),
            records: filtered.length,
            filter: body.filter ?? {},
            endpoints: buildContracts(filtered),
          }
          mkdirSync(baselineDir(), { recursive: true })
          writeFileSync(baselineFile(name), JSON.stringify(baseline, null, 2), 'utf8')
          writeJson(res, 200, { name, savedAt: baseline.savedAt, records: baseline.records, endpoints: Object.keys(baseline.endpoints).length })
          return
        }

        // POST /baseline/diff { name } — contract drift vs the saved baseline
        if (method === 'POST' && rest === '/baseline/diff') {
          let body = {}
          try {
            body = (await readJsonBody(req, 256 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const baseline = readBaseline(String(body.name ?? ''))
          if (baseline === null) {
            writeJson(res, 404, { error: 'baseline not found' })
            return
          }
          const current = buildContracts(applyFilters(readAll(), paramsFromObj(baseline.filter ?? {})))
          const changes = []
          const beforeKeys = new Set(Object.keys(baseline.endpoints))
          const afterKeys = new Set(Object.keys(current))
          for (const key of [...afterKeys].filter((k) => !beforeKeys.has(k))) {
            changes.push({ endpoint: key, kind: '新增端点', detail: '本次会话出现了基线之外的接口' })
          }
          for (const key of [...beforeKeys].filter((k) => !afterKeys.has(k))) {
            changes.push({ endpoint: key, kind: '端点缺失', detail: '基线中的接口本次没有再出现（可能被移除或未走到）' })
          }
          for (const key of beforeKeys) {
            if (!afterKeys.has(key)) continue
            const b = baseline.endpoints[key]
            const c = current[key]
            const detail = []
            const bStatus = new Set(b.statuses)
            const cStatus = new Set(c.statuses)
            for (const s of c.statuses) if (!bStatus.has(s)) detail.push(`状态码 +${s}`)
            for (const s of b.statuses) if (!cStatus.has(s)) detail.push(`状态码 -${s}`)
            for (const ct of c.contentTypes) if (!b.contentTypes.includes(ct)) detail.push(`Content-Type +${ct}`)
            for (const ct of b.contentTypes) if (!c.contentTypes.includes(ct)) detail.push(`Content-Type -${ct}`)
            for (const p of c.shape) if (!b.shape.includes(p)) detail.push(`响应字段 +${p}`)
            for (const p of b.shape) if (!c.shape.includes(p)) detail.push(`响应字段 -${p}`)
            if (detail.length > 0) {
              changes.push({ endpoint: key, kind: '契约变化', detail: detail.slice(0, 40).join('; ') + (detail.length > 40 ? ' …' : '') })
            }
          }
          writeJson(res, 200, {
            name: baseline.name,
            savedAt: baseline.savedAt,
            baselineRecords: baseline.records,
            currentRecords: applyFilters(readAll(), paramsFromObj(baseline.filter ?? {})).length,
            baselineEndpoints: Object.keys(baseline.endpoints).length,
            currentEndpoints: Object.keys(current).length,
            changes,
          })
          return
        }

        // DELETE /baseline/{name}
        const baselineMatch = rest.match(/^\/baseline\/([^/]+)$/)
        if (method === 'DELETE' && baselineMatch !== null) {
          const file = baselineFile(decodeURIComponent(baselineMatch[1]))
          if (!existsSync(file)) {
            writeJson(res, 404, { error: 'baseline not found' })
            return
          }
          rmSync(file, { force: true })
          writeJson(res, 200, { deleted: 1 })
          return
        }

        // POST /source/locate { vm?, api?, stack? } — find client source files defining the caller
        if (method === 'POST' && rest === '/source/locate') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          writeJson(res, 200, searchSource({ vm: body.vm, api: body.api }))
          return
        }

        // POST /source/open { path, line } — open a located file (VS Code with line, else explorer)
        if (method === 'POST' && rest === '/source/open') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const target = String(body.path ?? '')
          const roots = srcRoots()
          const inside = roots.some((root) => {
            const rel = relative(root, target)
            return rel !== '' && !rel.startsWith('..')
          })
          if (!inside || !existsSync(target)) {
            writeJson(res, 400, { error: 'path outside source roots or missing' })
            return
          }
          const line = Number.isInteger(body.line) && body.line > 0 ? body.line : 1
          const localAppData = process.env.LOCALAPPDATA ?? ''
          const codeCandidates = [
            ...(typeof process.env.DSH_CODE_EXE === 'string' && process.env.DSH_CODE_EXE.trim() !== '' ? [process.env.DSH_CODE_EXE.trim()] : []),
            localAppData !== '' ? join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
            'C:\\Program Files\\Microsoft VS Code\\Code.exe',
          ].filter((p) => p !== '' && existsSync(p))
          let opened = null
          if (codeCandidates.length > 0) {
            // `start` detaches the GUI process; cmd exits 0 immediately once launched
            opened = await new Promise((resolve) => {
              execFile('cmd.exe', ['/c', 'start', '', codeCandidates[0], '-g', `${target}:${line}`], { timeout: 10000, windowsHide: true }, (error) => {
                resolve(error === null ? 'vscode' : null)
              })
            })
          }
          if (opened === null) {
            // `start` returns immediately (exit 0) even though explorer opens async
            opened = await new Promise((resolve) => {
              execFile('cmd.exe', ['/c', 'start', '', 'explorer', `/select,${target}`], { timeout: 10000, windowsHide: true }, (error) => {
                resolve(error === null ? 'explorer' : null)
              })
            })
          }
          writeJson(res, 200, opened !== null ? { ok: true, method: opened, path: target, line } : { ok: false, error: 'open failed (no VS Code found; explorer launch failed)' })
          return
        }

        // POST /capture/rotate { keepDays? } — rotate the trace/caller logs (rename + prune old)
        if (method === 'POST' && rest === '/capture/rotate') {
          let body = {}
          try {
            body = (await readJsonBody(req, 64 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const keepDays = Math.max(0, Math.min(Number(body.keepDays ?? 7) || 7, 365))
          writeJson(res, 200, capture.rotate({ keepDays, pruneOnly: body.pruneOnly === true }))
          return
        }

        // GET /proxy/rules — AutoResponder rule list (+ hit counters)
        if (method === 'GET' && rest === '/proxy/rules') {
          writeJson(res, 200, proxy.getRules())
          return
        }

        // POST /proxy/rules { rules: [...] } — replace the rule set
        if (method === 'POST' && rest === '/proxy/rules') {
          let body = {}
          try {
            body = (await readJsonBody(req, 256 * 1024)) ?? {}
          } catch {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const list = Array.isArray(body) ? body : body.rules
          if (!Array.isArray(list)) {
            writeJson(res, 400, { error: 'expected { rules: [...] } or an array' })
            return
          }
          writeJson(res, 200, proxy.setRules(list))
          return
        }

        // DELETE /proxy/rules — clear all rules
        if (method === 'DELETE' && rest === '/proxy/rules') {
          writeJson(res, 200, proxy.setRules([]))
          return
        }

        writeJson(res, 404, { error: 'not found' })
      },
    },
  ]
}

/** The api_capture_append agent tool: push captured API records into the store. */
function apiCaptureTool() {
  return defineTool({
    name: 'api_capture_append',
    description:
      'Append captured API-call records to the dsh-api-visualizer store (local records.jsonl); they appear live in the GUI 「接口捕获」 panel. ' +
      'Use after capturing interfaces from the client process (e.g. ETW trace, proxy log, client log parsing). ' +
      'Triggers: 抓接口 / 接口可视化 / 上报接口记录 / record captured APIs.',
    parameters: {
      records: {
        type: 'array',
        required: true,
        description: 'Captured API records. Each record: method + url are required; status/durationMs/reqBody/resBody/note optional. Keep reqBody/resBody ≤ 2MB.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            method: { type: 'string', required: true, description: 'HTTP method, e.g. GET/POST.' },
            url: { type: 'string', required: true, description: 'Request URL (absolute or relative).' },
            status: { type: 'integer', description: 'HTTP status code, if known.' },
            durationMs: { type: 'number', description: 'Round-trip duration in ms, if known.' },
            source: { type: 'string', description: 'Capture origin tag: etw / proxy / client-log / agent / other.' },
            process: { type: 'string', description: 'Source process name, e.g. client.exe.' },
            reqHeaders: { type: 'object', additionalProperties: true, description: 'Request headers, if known.' },
            reqBody: { type: 'string', description: 'Request body (truncated to 2MB).' },
            resHeaders: { type: 'object', additionalProperties: true, description: 'Response headers, if known.' },
            resBody: { type: 'string', description: 'Response body (truncated to 2MB).' },
            firstByteMs: { type: 'number', description: 'Time to first response byte.' },
            bytesReq: { type: 'number', description: 'Request bytes observed.' },
            bytesRes: { type: 'number', description: 'Response bytes observed.' },
            chunkCount: { type: 'integer', description: 'Observed response/request chunks.' },
            complete: { type: 'boolean', description: 'Whether the response completed.' },
            streaming: { type: 'boolean', description: 'Whether the response is streaming-like.' },
            sessionId: { type: 'string', description: 'Explicit request session identifier.' },
            traceId: { type: 'string', description: 'Distributed trace identifier.' },
            parentId: { type: 'string', description: 'Parent request identifier.' },
            caller: { type: 'object', additionalProperties: true, description: 'Caller attribution: {viewModel, view, apiMethod, trigger, stack[]}.' },
            tag: { type: 'string', description: 'Short tag label.' },
            flag: { type: 'boolean', description: 'Mark the record (starred).' },
            ttfbMs: { type: 'number', description: 'Time to first response byte (alias of firstByteMs).' },
            connectMs: { type: 'number', description: 'TCP connect time (proxy captures).' },
            tlsMs: { type: 'number', description: 'TLS handshake time (proxy captures).' },
            ruleId: { type: 'string', description: 'AutoResponder rule id when the record was mocked/rewritten.' },
            ws: { type: 'object', additionalProperties: true, description: 'WebSocket metadata: {frames, closeCode, closeReason, frameCount, msgCount}.' },
            note: { type: 'string', description: 'Human note, e.g. what this interface does.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ingested: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `ingested: ${value.ingested}, store total: ${value.total}` }],
    },
    async execute(args) {
      return appendRecords(args.records)
    },
  })
}

/** Build a URLSearchParams from a plain object (shared by tool + routes). */
const FILTER_PARAM_ALIASES = Object.freeze({
  flagged: 'flag',
  ct: 'contentType',
  minDur: 'minDurationMs',
  errorsOnly: 'errors',
})

function paramsFromObj(obj) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value === undefined || value === null || value === '' || value === false) continue
    params.set(FILTER_PARAM_ALIASES[key] ?? key, value === true ? '1' : String(value))
  }
  return params
}

/** The api_capture_query agent tool: read/filter captured records. */
function apiQueryTool() {
  return defineTool({
    name: 'api_capture_query',
    description:
      'Query records stored by the dsh-api-visualizer capture panel (local records store). ' +
      'Returns method/url/status/duration plus caller attribution (which ViewModel/API fired each request). ' +
      'Use to analyze captured client traffic: slow calls, errors, a specific host, or requests fired by one ViewModel. ' +
      'Triggers: 查询接口记录 / 分析捕获 / 哪些接口慢 / 接口报错分析 / query captured APIs.',
    parameters: {
      limit: { type: 'integer', description: 'Max records to return (default 50, max 500).' },
      offset: { type: 'integer', description: 'Skip the newest N matching records (default 0).' },
      q: { type: 'string', description: 'Substring match against url/note.' },
      method: { type: 'string', description: 'HTTP method filter (GET/POST/...).' },
      source: { type: 'string', description: 'Capture source: realtime / proxy / agent / etw.' },
      status: { type: 'string', description: 'Status filter: exact code or 2xx/3xx/4xx/5xx.' },
      host: { type: 'string', description: 'Hostname filter (comma-separated list).' },
      minDurationMs: { type: 'number', description: 'Only records at least this slow (ms).' },
      minBytes: { type: 'number', description: 'Min response bytes.' },
      maxBytes: { type: 'number', description: 'Max response bytes.' },
      fromTs: { type: 'number', description: 'Earliest record timestamp (epoch ms).' },
      toTs: { type: 'number', description: 'Latest record timestamp (epoch ms).' },
      sessionId: { type: 'string', description: 'Session key filter.' },
      traceId: { type: 'string', description: 'Distributed trace id filter.' },
      errors: { type: 'boolean', description: 'Only HTTP 4xx/5xx records.' },
      noNoise: { type: 'boolean', description: 'Hide static-resource/heartbeat noise.' },
      bodyQ: { type: 'string', description: 'Substring match inside request/response bodies/headers.' },
      caller: { type: 'string', description: 'Match caller attribution (viewModel / apiMethod / stack frame substring).' },
      includeBody: { type: 'boolean', description: 'Include request/response bodies (off by default to keep output small).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          returned: { type: 'integer', required: true },
          hasMore: { type: 'boolean', required: true },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const head = `matched ${value.total} record(s), returning ${value.returned}`
        const lines = (value.items ?? []).map((r) => {
          const c = r.caller ?? {}
          const who = [c.viewModel, c.apiMethod].filter(Boolean).join(' ← ')
          return `${r.ts ?? '-'} ${r.method ?? '?'} ${r.status ?? '-'} ${fmtMs(r.durationMs)} ${who !== '' ? `[${who}] ` : ''}${r.url ?? ''}`
        })
        return [{ type: 'text', text: `${head}\n${lines.join('\n')}` }]
      },
    },
    async execute(args) {
      const params = paramsFromObj(args)
      let items = applyFilters(readAll(), params)
      const caller = (args.caller ?? '').trim().toLowerCase()
      if (caller !== '') {
        items = items.filter((r) => {
          const c = r.caller ?? {}
          const hay = [c.viewModel, c.view, c.apiMethod, c.trigger, ...(Array.isArray(c.stack) ? c.stack : [])].filter(Boolean).join('\n').toLowerCase()
          return hay.includes(caller)
        })
      }
      const total = items.length
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500)
      const offset = Math.max(Number(args.offset) || 0, 0)
      const page = items.slice(Math.max(items.length - offset - limit, 0), Math.max(items.length - offset, 0)).reverse()
      const out = args.includeBody === true ? page : withoutBodies(page)
      return { total, returned: out.length, hasMore: items.length > offset + page.length, items: out }
    },
  })
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Host-managed realtime capture: CaptureEngine -> batched store append.
 * Records are written straight into the JSONL store (source='realtime'),
 * so the panel sees them on its next poll — Fiddler-style live flow.
 */
function createCapture() {
  let queue = []
  let engine = null
  let flushTimer = null
  let logPath = process.env.DSH_CAPTURE_LOG ?? DEFAULT_LOG
  let callerLogPath = process.env.DSH_CAPTURE_CALLER_LOG ?? DEFAULT_CALLER_LOG

  const AUTO_ROTATE_BYTES = 300 * 1024 * 1024

  /** Rename a trace log to a timestamped .bak; returns 'rotated' | 'skipped' | 'missing'. */
  const rotateFile = (file) => {
    if (!existsSync(file)) return 'missing'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const dest = `${file}.${stamp}.bak`
    try {
      renameSync(file, dest)
      return 'rotated'
    } catch {
      return 'skipped' // locked by the client process
    }
  }

  const pruneOldBaks = (keepDays) => {
    const tempDir = process.env.TEMP || process.env.TMP || ''
    const dirs = [...new Set([tempDir, dirname(logPath), dirname(callerLogPath)])].filter((d) => d !== '' && existsSync(d))
    const cutoff = Date.now() - keepDays * 86400000
    let pruned = 0
    for (const dir of dirs) {
      try {
        for (const name of readdirSync(dir)) {
          if (!/^uiprobe-(net-trace|caller)\.log\.\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.bak$/.test(name)) continue
          const full = join(dir, name)
          try {
            if (statSync(full).mtimeMs < cutoff) {
              rmSync(full, { force: true })
              pruned++
            }
          } catch {
            // skip
          }
        }
      } catch {
        // best effort
      }
    }
    return pruned
  }

  const startFlush = () => {
    if (flushTimer !== null) return
    flushTimer = setInterval(() => {
      if (queue.length === 0) return
      const batch = queue.splice(0, queue.length)
      try {
        appendRecords(batch)
      } catch {
        queue.unshift(...batch)
      }
    }, 800)
  }
  const stopFlush = () => {
    if (flushTimer !== null) {
      clearInterval(flushTimer)
      flushTimer = null
    }
  }
  const ensure = () => {
    if (engine === null) {
      engine = new CaptureEngine({ logPath, callerLogPath, onRecord: (rec) => { queue.push(rec) } })
    }
    return engine
  }
  const wasRunning = () => engine !== null && engine.tailer.running === true

  const doRotate = ({ keepDays = 7, pruneOnly = false } = {}) => {
    const result = { trace: 'missing', caller: 'missing', pruned: 0, restarted: false }
    if (!pruneOnly) {
      const running = wasRunning()
      if (running) engine.stop()
      result.trace = rotateFile(logPath)
      result.caller = rotateFile(callerLogPath)
      if (running) {
        if (engine !== null) engine.start()
        result.restarted = true
      }
    }
    result.pruned = pruneOldBaks(keepDays)
    return result
  }

  return {
    start({ replay = false, autoRotate = true } = {}) {
      const eng = ensure()
      if (autoRotate && !wasRunning()) {
        let size = 0
        try {
          size = statSync(logPath).size
        } catch {
          size = 0
        }
        if (size > AUTO_ROTATE_BYTES) doRotate({ keepDays: 7, pruneOnly: false })
      }
      if (replay === true && eng.tailer.startedAt === null) eng.tailer.replay = true
      eng.start()
      startFlush()
    },
    stop() {
      if (engine !== null) engine.stop()
      stopFlush()
    },
    setLogPath(path) {
      if (path === logPath) return
      if (engine !== null && engine.tailer.running) throw new Error('capture running; stop it before changing logPath')
      logPath = path
      engine = null
    },
    setCallerLogPath(path) {
      if (path === callerLogPath) return
      if (engine !== null && engine.callerTailer.running) throw new Error('capture running; stop it before changing caller logPath')
      callerLogPath = path
      engine = null
    },
    rotate({ keepDays = 7, pruneOnly = false } = {}) {
      return doRotate({ keepDays, pruneOnly })
    },
    status() {
      if (engine === null) {
        return { running: false, logPath, logExists: existsSync(logPath), logSize: null, offset: 0, replay: false, startedAt: null, errors: 0, counters: null }
      }
      return engine.status()
    },
    dispose() {
      if (engine !== null) engine.stop()
      stopFlush()
    },
  }
}

/** Host-managed local MITM proxy: records batched into the same store (source='proxy'). */
function createProxy() {
  let queue = []
  let engine = null
  let flushTimer = null

  const startFlush = () => {
    if (flushTimer !== null) return
    flushTimer = setInterval(() => {
      if (queue.length === 0) return
      const batch = queue.splice(0, queue.length)
      try {
        appendRecords(batch)
      } catch {
        queue.unshift(...batch)
      }
    }, 800)
  }
  const stopFlush = () => {
    if (flushTimer !== null) {
      clearInterval(flushTimer)
      flushTimer = null
    }
  }
  const ensure = () => {
    if (engine === null) {
      engine = new ProxyEngine({
        certDir: join(storeDir(), 'proxy-certs'),
        onRecord: (rec) => { queue.push(rec) },
      })
    }
    return engine
  }

  return {
    start({ port = 8899, upstream = undefined } = {}) {
      const eng = ensure()
      eng.start({ port, upstream })
      startFlush()
      return eng.status()
    },
    stop() {
      if (engine !== null) engine.stop()
      stopFlush()
      return engine !== null ? engine.status() : { running: false }
    },
    status() {
      if (engine === null) {
        return { running: false, port: 8899, upstream: null, caPath: join(storeDir(), 'proxy-certs', 'ca-cert.pem'), caReady: false, systemProxyActive: false, counters: null, startedAt: null }
      }
      return engine.status()
    },
    installCa() {
      return ensure().installCa()
    },
    caCertDerPath() {
      return ensure().exportCaDer()
    },
    setSystemProxy(enable) {
      return ensure().setSystemProxy(enable)
    },
    getRules() {
      return ensure().getRules()
    },
    setRules(list) {
      return ensure().setRules(list)
    },
    dispose() {
      this.stop()
    },
  }
}

/**
 * Mount the routes, tool, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 */
export function apply(ctx) {
  const capture = createCapture()
  const proxy = createProxy()
  const routes = makeRoutes(capture, proxy)
  const disposeRoutes = ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-api-visualizer: routes',
  )
  const disposeTool = ctx.effect(() => ctx.tools.register(apiCaptureTool()), 'dsh-api-visualizer: tools')
  const disposeQueryTool = ctx.effect(() => ctx.tools.register(apiQueryTool()), 'dsh-api-visualizer: query-tool')
  const disposeSection = ctx.systemPrompt.section({
    name: 'plugin:api-visualizer',
    order: SECTION_ORDER,
    text: GUIDANCE,
  })
  ctx.effect(
    () => () => {
      disposeRoutes()
      disposeTool()
      disposeQueryTool()
      disposeSection()
      capture.dispose()
      proxy.dispose()
    },
    'dsh-api-visualizer: teardown',
  )
}

// Test surface (unused by the cordis loader; keeps the store/filter logic unit-testable).
export { applyFilters, buildContracts, createCapture, createProxy, endpointKeyOf, jsonShape, normalize, paramsFromObj, searchSource }
