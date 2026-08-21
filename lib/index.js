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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CaptureEngine, DEFAULT_LOG } from './capture-engine.mjs'
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
  '能力：记录存本地 JSONL 库（records.jsonl，追加写入，上限 20000 条）；面板内「开始实时捕获」按钮驱动宿主实时引擎，tail 客户端 System.Net 跟踪日志（%TEMP%\\uiprobe-net-trace.log，由客户端配置的 system.diagnostics 注入产生）自动解析出 方法/URL/状态/请求头/响应头/请求体/响应体（gzip 自动解包）并实时入库，source=realtime；' +
  '对应路由：POST /api/dsh-api-visualizer/capture/start（body 可选 {logPath, replay}）、POST /capture/stop、GET /capture/status；agent 也可用 api_capture_append 工具手动追加记录，或经 POST /api/dsh-api-visualizer/ingest 灌入。' +
  '本地代理模式（抓任意进程，Fiddler 式）：POST /proxy/start（body 可选 {port, upstream}，默认 8899、上游自动读系统代理）、POST /proxy/stop、GET /proxy/status、GET /proxy/ca-cert.der（根证书下载）、POST /proxy/install-ca（导入本机信任，免管理员）、POST /proxy/system-proxy（body {enable}，把系统代理指向本代理/恢复原值）；HTTPS 走 CONNECT + 按域签发证书解密，source=proxy。' +
  '记录编辑：PATCH /records/{id}（body {note?, tag?, flag?}）；列表过滤支持 flag=1（只看标记）。' +
  '限制：实时捕获依赖客户端已注入 system.diagnostics 跟踪配置（重启客户端后生效）；请求/响应体截断 ≤ 2MB；日志与记录含真实 token（本机本地存储，不外传，用户明确要求不脱敏）。' +
  '用户提到「接口可视化 / 抓接口 / 接口面板 / 接口捕获 / 实时抓包 / Fiddler」时即指本插件，请据此协作。'

/** Primary store location (env override, then the dsh data drive, then ~/.dsh). */
function storeDir() {
  if (process.env.DSH_API_CAPTURE_STORE) return process.env.DSH_API_CAPTURE_STORE
  if (existsSync('E:\\')) return 'E:\\dsh-files\\api-capture'
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'api-capture')
}
const storeFile = () => join(storeDir(), 'records.jsonl')

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
  return rec
}

/** Parse the JSONL store into records (newest last). */
function readAll() {
  const file = storeFile()
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (text === '') continue
    try {
      out.push(JSON.parse(text))
    } catch {
      // skip malformed lines (manual edits, concurrent writers)
    }
  }
  return out
}

/** Append normalized records; rotate when over the cap. */
function appendRecords(rawRecords) {
  const records = []
  for (const raw of rawRecords) {
    const rec = normalize(raw)
    if (rec !== null) records.push(rec)
  }
  if (records.length === 0) return { ingested: 0, total: readAll().length }
  mkdirSync(storeDir(), { recursive: true })
  const file = storeFile()
  appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  let all = readAll()
  if (all.length > MAX_RECORDS) {
    all = all.slice(all.length - MAX_RECORDS)
    writeFileSync(file, all.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  }
  return { ingested: records.length, total: all.length }
}

/** Drop every record. */
function clearRecords() {
  const all = readAll()
  const file = storeFile()
  if (existsSync(file)) writeFileSync(file, '', 'utf8')
  return { cleared: all.length }
}

/** Store API, exported for capture backends and tests. */
export { storeDir, storeFile, readAll, appendRecords, clearRecords }

/** Strip bodies from list payloads (keep the table light). */
function withoutBodies(records) {
  return records.map((r) => {
    const { reqBody, resBody, ...rest } = r
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

/** Static-resource / heartbeat noise patterns (hide-no-noise filter). */
const NOISE_PATTERNS = [
  /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|map)([?#]|$)/i,
  /(heart|ping|beacon|favicon)/i,
  /buryingpoint/i,
]

/**
 * Shared filter pipeline for GET /records and DELETE /records?filtered=1.
 * Params: q, regex, method, source, status, flag, host (comma list),
 * contentType (comma list, substring), minDurationMs, errors, noNoise, bodyQ.
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
  const hostFilter = (params.get('host') ?? '').trim().toLowerCase()
  const ctFilter = (params.get('contentType') ?? '').trim().toLowerCase()
  const minDurRaw = params.get('minDurationMs')
  const minDur = minDurRaw === null || minDurRaw === '' ? null : Number(minDurRaw)
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
    items = statusFilter.endsWith('xx')
      ? items.filter((r) => Number.isInteger(r.status) && Math.floor(r.status / 100) === Number(statusFilter[0]))
      : items.filter((r) => String(r.status) === statusFilter)
  }
  if (params.get('flag') === '1') items = items.filter((r) => r.flag === true)
  if (hostFilter !== '') {
    const hosts = hostFilter.split(',').map((h) => h.trim()).filter((h) => h !== '')
    items = items.filter((r) => hosts.includes(hostOf(r)))
  }
  if (ctFilter !== '') {
    const cts = ctFilter.split(',').map((c) => c.trim()).filter((c) => c !== '')
    items = items.filter((r) => {
      const ct = String((r.resHeaders ?? {})['content-type'] ?? '').toLowerCase()
      return cts.some((c) => ct.includes(c))
    })
  }
  if (minDur !== null && Number.isFinite(minDur)) items = items.filter((r) => Number.isFinite(r.durationMs) && r.durationMs >= minDur)
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

        // GET /records?limit&offset&q&regex&method&source&status&flag&host&contentType&minDurationMs&errors&noNoise&bodyQ&includeBody
        if (method === 'GET' && rest === '/records') {
          const all = readAll()
          const includeBody = params.get('includeBody') === '1'
          const limit = Math.min(Number(params.get('limit') ?? 200) || 200, 2000)
          const offset = Math.max(Number(params.get('offset') ?? 0) || 0, 0)
          const items = applyFilters(all, params)
          const total = items.length
          const page = items.slice(Math.max(items.length - offset - limit, 0), Math.max(items.length - offset, 0))
          page.reverse()
          writeJson(res, 200, { total, items: includeBody ? page : withoutBodies(page) })
          return
        }

        // GET /stats/endpoints — aggregate by method + path (P1 observability)
        if (method === 'GET' && rest === '/stats/endpoints') {
          const all = readAll()
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
          writeFileSync(storeFile(), all.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
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
          writeFileSync(storeFile(), kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
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
            writeFileSync(storeFile(), all.filter((r) => !ids.has(r.id)).map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
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
      engine = new CaptureEngine({ logPath, onRecord: (rec) => { queue.push(rec) } })
    }
    return engine
  }

  return {
    start({ replay = false } = {}) {
      const eng = ensure()
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
    status() {
      if (engine === null) {
        return { running: false, logPath, logExists: existsSync(logPath), logSize: null, offset: 0, replay: false, startedAt: null, errors: 0, counters: null }
      }
      return engine.status()
    },
    dispose() {
      this.stop()
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
  const disposeSection = ctx.systemPrompt.section({
    name: 'plugin:api-visualizer',
    order: SECTION_ORDER,
    text: GUIDANCE,
  })
  ctx.effect(
    () => () => {
      disposeRoutes()
      disposeTool()
      disposeSection()
      capture.dispose()
      proxy.dispose()
    },
    'dsh-api-visualizer: teardown',
  )
}
