/**
 * dsh-api-visualizer — local HTTP(S) MITM proxy engine (Fiddler-style).
 *
 * Captures HTTP traffic from ANY process that points its proxy at this
 * engine (or via the Windows system-proxy toggle). Plain HTTP is recorded
 * as-is; HTTPS goes through CONNECT + on-the-fly per-host certificates
 * signed by a locally generated root CA (user imports the CA once).
 *
 * Corporate-network friendly: when an upstream proxy is configured (the
 * default is read from the current WinINET settings), every connection —
 * including CONNECT tunnels — is chained through it, so proxied apps keep
 * their normal network reachability.
 *
 * Records flow through `onRecord` (same shape as the realtime capture
 * engine; source='proxy'). No dsh source changes.
 */

import { createRequire } from 'node:module'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'

const require = createRequire(import.meta.url)
const forge = require('node-forge')

/** Per-field body cap for stored records (2MB). */
const BODY_CAP = 2 * 1024 * 1024
/** Stop buffering a body beyond this (still streams to the client). */
const BUFFER_CAP = 50 * 1024 * 1024
/** Abort an idle streaming response instead of retaining it forever. */
const STREAM_IDLE_TIMEOUT = 120000
/** Do not write a progress update for every tiny response chunk. */
const STREAM_UPDATE_MS = 250

const HOP_BY_HOP = new Set([
  'connection', 'proxy-connection', 'keep-alive', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
])

function stripHopByHop(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (HOP_BY_HOP.has(String(k).toLowerCase())) continue
    out[k] = v
  }
  return out
}

/** Headers that must be dropped when rebuilding a WebSocket request head. */
const WS_DROP_HEADERS = new Set(['proxy-connection', 'proxy-authorization', 'proxy-authenticate'])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

/** Glob (* wildcard only) → anchored case-insensitive regexp. */
function globToRegExp(pattern) {
  const esc = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

/**
 * AutoResponder rule match. Rule shape:
 * { id, enabled, name, match: { method?, host?, url?, urlType? ('contains'|'glob'|'regex') },
 *   action: { type: 'mock'|'delay'|'block'|'rewrite-status', latencyMs?, status?, headers?, body? }, hits }
 */
function matchRule(rule, req) {
  if (rule === null || rule === undefined || rule.enabled === false) return false
  const m = rule.match ?? {}
  if (m.method && String(m.method).toUpperCase() !== String(req.method).toUpperCase()) return false
  if (m.host && String(m.host).trim() !== '' && String(req.host).toLowerCase() !== String(m.host).trim().toLowerCase()) return false
  const pattern = String(m.url ?? '').trim()
  if (pattern === '') return true
  const type = m.urlType ?? 'contains'
  if (type === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(req.url)
    } catch {
      return false
    }
  }
  if (type === 'glob') return globToRegExp(pattern).test(req.url)
  return String(req.url).toLowerCase().includes(pattern.toLowerCase())
}

/**
 * Minimal WebSocket frame splitter (RFC 6455).
 * One instance per direction; `feed` appends raw bytes and returns parsed frames.
 * For masked directions pass mask=true (client→server). Text payloads are decoded
 * (utf-8) and fragmented messages are reassembled; a close frame reports its code.
 */
class WsFrameParser {
  constructor({ masked, onText = () => {} } = {}) {
    this.masked = masked === true
    this.carry = Buffer.alloc(0)
    this.frames = [] // {op, len, fin, text?}
    this.textBuf = ''
    this.fragmentOp = null
    this.closeCode = null
    this.closeReason = ''
    this.msgCount = 0
    this.frameCount = 0
    this.onText = onText
  }

  /** Parse as many frames as possible; returns true when nothing malformed was seen. */
  feed(chunk) {
    this.carry = Buffer.concat([this.carry, chunk])
    while (true) {
      const buf = this.carry
      if (buf.length < 2) return true
      const b0 = buf[0]
      const fin = (b0 & 0x80) !== 0
      const op = b0 & 0x0f
      const masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f
      let offset = 2
      if (len === 126) {
        if (buf.length < 4) return true
        len = buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (buf.length < 10) return true
        const big = buf.readBigUInt64BE(2)
        if (big > 0x7fffffffffffffffn) {
          this.carry = Buffer.alloc(0) // absurd length — drop
          return false
        }
        len = Number(big)
        offset = 10
      }
      let maskKey = null
      if (masked) {
        if (buf.length < offset + 4) return true
        maskKey = buf.subarray(offset, offset + 4)
        offset += 4
      }
      if (len > 16 * 1024 * 1024) {
        this.carry = Buffer.alloc(0) // refuse to buffer giant frames
        return false
      }
      if (buf.length < offset + len) return true
      let payload = buf.subarray(offset, offset + len)
      this.carry = buf.subarray(offset + len)
      if (maskKey !== null) {
        const out = Buffer.alloc(payload.length)
        for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ maskKey[i & 3]
        payload = out
      }
      this.frameCount++
      const rec = { op, len, fin }
      const isText = op === 1 || (op === 0 && this.fragmentOp === 1)
      if (isText) {
        const text = payload.toString('utf8')
        this.textBuf += text
        if (op === 1) this.msgCount++
        if (this.textBuf.length > 2 * 1024 * 1024) this.textBuf = this.textBuf.slice(0, 2 * 1024 * 1024)
        rec.text = text.length > 4000 ? text.slice(0, 4000) + '…' : text
      } else if (op === 8) {
        if (payload.length >= 2) {
          this.closeCode = payload.readUInt16BE(0)
          try {
            this.closeReason = payload.subarray(2).toString('utf8').slice(0, 120)
          } catch {
            this.closeReason = ''
          }
        }
      }
      if (this.frames.length < 300) this.frames.push(rec)
      if (!fin && (op === 1 || op === 2)) this.fragmentOp = op
      if (fin && isText) {
        this.onText(this.textBuf)
        this.textBuf = ''
      }
      if (fin && (op === 0 || op === 1 || op === 2)) this.fragmentOp = null
    }
  }
}

/** Decode a raw body for storage: gzip/deflate/br, charset-aware (GBK etc.), image=base64, binary=hex, capped. */
function bodyForStore(rawBuf, encoding, contentType) {
  if (rawBuf.length === 0) return ''
  let buf = rawBuf
  const enc = String(encoding ?? '').toLowerCase()
  if (enc.includes('gzip')) {
    try {
      buf = zlib.gunzipSync(buf)
    } catch {
      return '' // undecodable compressed stream
    }
  } else if (enc.includes('deflate')) {
    try {
      buf = zlib.inflateSync(buf)
    } catch {
      try {
        buf = zlib.inflateRawSync(buf)
      } catch {
        return ''
      }
    }
  } else if (enc.includes('br')) {
    try {
      buf = zlib.brotliDecompressSync(buf)
    } catch {
      return ''
    }
  }
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.includes('image/')) {
    if (buf.length <= 1.5 * 1024 * 1024) {
      const mime = ct.split(';')[0].trim()
      return `base64:${mime};${buf.toString('base64')}`
    }
    return ''
  }
  let charset = null
  const cm = /charset=["']?([\w-]+)/i.exec(contentType ?? '')
  if (cm !== null) charset = cm[1].toLowerCase()
  let text
  try {
    text = new TextDecoder(charset ?? 'utf-8').decode(buf)
  } catch {
    text = buf.toString('utf8')
  }
  let control = 0
  for (let i = 0; i < Math.min(text.length, 512); i++) {
    const c = text.charCodeAt(i)
    if (c < 9 || (c > 13 && c < 32)) control++
  }
  if (control > 16 && !text.startsWith('{') && !text.startsWith('[')) {
    const cap = Math.min(buf.length, 64 * 1024)
    return 'hex:' + buf.subarray(0, cap).toString('hex')
  }
  if (text.length > BODY_CAP) text = text.slice(0, BODY_CAP) + '…(截断)'
  return text
}

/** Read WinINET proxy settings (HKCU). */
function readSystemProxy() {
  const result = { enable: false, server: '', override: '' }
  try {
    const { execFileSync } = require('node:child_process')
    const raw = execFileSync('reg.exe', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable',
    ], { encoding: 'utf8' })
    const m = /0x([0-9a-fA-F]+)/.exec(raw)
    result.enable = m !== null && Number.parseInt(m[1], 16) === 1
    const raw2 = execFileSync('reg.exe', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer',
    ], { encoding: 'utf8' })
    const m2 = /REG_SZ\s+(.+)/.exec(raw2)
    if (m2 !== null) result.server = m2[1].trim()
    const raw3 = execFileSync('reg.exe', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyOverride',
    ], { encoding: 'utf8' })
    const m3 = /REG_SZ\s+(.+)/.exec(raw3)
    if (m3 !== null) result.override = m3[1].trim()
  } catch {
    // registry keys absent / reg.exe unavailable
  }
  return result
}

function writeSystemProxy({ enable, server, override }) {
  const reg = (args) => {
    return new Promise((resolve) => {
      execFile('reg.exe', args, { encoding: 'utf8' }, (error, stdout) => {
        resolve(error === null ? stdout : null)
      })
    })
  }
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  if (server !== '' && server !== undefined) {
    return reg(['add', key, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', server, '/f']).then(async () => {
      await reg(['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', enable ? '1' : '0', '/f'])
      if (override !== undefined && override !== '') {
        await reg(['add', key, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', override, '/f'])
      }
      return true
    })
  }
  return reg(['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', enable ? '1' : '0', '/f']).then(() => true)
}

/** Notify WinINET of the settings change (InternetSetOption 39 + 37). */
function refreshWinInet() {
  return new Promise((resolve) => {
    const ps = [
      "Add-Type @'",
      'using System; using System.Runtime.InteropServices;',
      'public class WinInet { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l); }',
      "'@",
      '[WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null',
      '[WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null',
    ].join('\n')
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000 }, (error) => {
      resolve(error === null)
    })
  })
}

/**
 * Parse an upstream proxy spec into { host, port, auth }.
 * Accepts `http://127.0.0.1:6518`, bare `host:port`, `user:pass@host:port`
 * (auth → preemptive Basic header), and WinINET's per-protocol form
 * `http=host:80;https=host:443;socks=host:1080`. We chain a single upstream,
 * so the segmented form prefers the https segment (covers CONNECT tunnels +
 * most captured traffic), then http, then socks, then whatever's first.
 */
function parseUpstream(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return null
  let s = spec.trim()
  if (s.includes('=')) {
    const segs = {}
    for (const part of s.split(';')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const scheme = part.slice(0, eq).trim().toLowerCase()
      const val = part.slice(eq + 1).trim()
      if (scheme !== '' && val !== '') segs[scheme] = val
    }
    s = segs.https || segs.http || segs.socks || Object.values(segs)[0] || ''
    if (s === '') return null
  }
  if (!s.includes('://')) s = 'http://' + s
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const host = u.hostname || '127.0.0.1'
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  let auth = null
  if (u.username !== '') {
    // 上游代理凭据（企业代理常需 407 认证）→ 预置 Basic 头，绝不落日志。
    const user = decodeURIComponent(u.username)
    const pass = decodeURIComponent(u.password)
    auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  }
  return { host, port, auth }
}

/** Open (and optionally TLS-wrap) a connection to host:port, chaining through the upstream proxy when set. */
function tunnelConnect({ upstream, host, port, secure }, cb, timing = null) {
  let done = false
  const fail = (error) => {
    if (done) return
    done = true
    cb(error)
  }
  const markConnect = () => {
    if (timing !== null && timing.connectMs === null) timing.connectMs = Date.now() - timing.t0
  }
  const wrapTls = (socket) => {
    markConnect()
    if (!secure) {
      done = true
      cb(null, socket)
      return
    }
    const tlsStarted = Date.now()
    const t = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: false, // capture-first tooling; see README
    })
    t.once('secureConnect', () => {
      if (timing !== null) timing.tlsMs = Date.now() - tlsStarted
      if (done) {
        t.destroy()
        return
      }
      done = true
      cb(null, t)
    })
    t.once('error', fail)
  }
  const connectDirect = () => {
    const s = net.connect(port, host)
    s.once('connect', () => wrapTls(s))
    s.once('error', fail)
  }
  if (upstream === null || upstream === undefined) {
    connectDirect()
    return
  }
  const s = net.connect(upstream.port, upstream.host)
  s.once('connect', () => {
    let connectReq = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Connection: keep-alive\r\n`
    if (upstream.auth) connectReq += `Proxy-Authorization: ${upstream.auth}\r\n`
    connectReq += '\r\n'
    s.write(connectReq)
    let buf = ''
    const onData = (d) => {
      buf += d.toString('latin1')
      const idx = buf.indexOf('\r\n\r\n')
      if (idx < 0) return
      s.removeListener('data', onData)
      const head = buf.slice(0, idx)
      const statusLine = head.split('\r\n')[0]
      const status = Number.parseInt(statusLine.split(' ')[1], 10)
      if (status === 200) {
        markConnect()
        wrapTls(s)
      } else if (status === 407) {
        // 企业代理要求认证。已带凭据仍 407 = 账号密码不对；未带 = 需要在上游
        // 地址用 user:pass@host:port 提供。Basic 预置即可；NTLM/Negotiate 多握
        // 手暂不支持，把 scheme 透传到错误里方便定位。
        s.destroy()
        const schemeM = /Proxy-Authenticate:\s*(\S+)/i.exec(buf)
        const scheme = schemeM !== null ? schemeM[1] : ''
        fail(new Error(upstream.auth
          ? `上游代理认证失败(407)，请检查代理账号密码`
          : `上游代理需要认证(407${scheme !== '' ? ' ' + scheme : ''})，请用 user:pass@host:port 提供凭据`))
      } else {
        s.destroy()
        fail(new Error(`upstream CONNECT failed: ${statusLine}`))
      }
    }
    s.on('data', onData)
  })
  s.once('error', fail)
}

/** Plain-HTTP agent whose connections are chained through the upstream proxy. */
class ForwardAgent extends http.Agent {
  constructor({ upstream }) {
    super({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32 })
    this.upstream = upstream
  }

  createConnection(options, cb) {
    tunnelConnect({ upstream: this.upstream, host: options.host, port: options.port, secure: false }, cb, options.__timing ?? null)
  }
}

/** HTTPS agent: upstream-chained CONNECT + TLS inside createConnection (protocol must be https:). */
class SecureForwardAgent extends https.Agent {
  constructor({ upstream }) {
    super({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32 })
    this.upstream = upstream
  }

  createConnection(options, cb) {
    tunnelConnect({ upstream: this.upstream, host: options.host, port: options.port, secure: true }, cb, options.__timing ?? null)
  }
}

export { matchRule, WsFrameParser }
export class ProxyEngine {
  constructor({ certDir, port = 8899, upstream = undefined, onRecord = () => {} } = {}) {
    this.certDir = certDir
    this.port = port
    this.upstream = upstream // {host,port} | null(=direct) | undefined(=auto: read system proxy)
    this.onRecord = onRecord
    this.server = null
    this.counters = { requests: 0, mitm: 0, errors: 0, ws: 0, rulesHits: 0, rulesMocks: 0 }
    this.ca = null
    this.hostCerts = new Map()
    this.agents = null
    this.secureAgents = null
    this.backupSystemProxy = null
    this.rulesFile = path.join(path.dirname(certDir), 'proxy-rules.json')
    this.rulesCache = { key: '', rules: [] }
    this.rulesFlushTimer = null
    this.lastError = null
    // 请求断点：默认关闭；enabled=false 时 bpMatch 立即返回 false，对正常流零影响。
    this.breakpoints = { enabled: false, urlFilter: '', methodFilter: '' }
    this.paused = new Map() // id -> { id, phase, data, resolve, timer, createdAt }
    this._pauseSeq = 0
  }

  // ------------------------------------------------------------ AutoResponder

  rulesFileKey() {
    try {
      const st = fs.statSync(this.rulesFile)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }

  loadRules() {
    const key = this.rulesFileKey()
    if (this.rulesCache.key === key || this.rulesCache.key === 'dirty') return this.rulesCache.rules
    let rules = []
    if (key !== 'missing') {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.rulesFile, 'utf8'))
        if (Array.isArray(parsed)) rules = parsed
      } catch {
        rules = []
      }
    }
    this.rulesCache = { key, rules }
    return rules
  }

  getRules() {
    const rules = this.loadRules()
    return {
      file: this.rulesFile,
      total: rules.length,
      enabled: rules.filter((r) => r.enabled !== false).length,
      rules: rules.map((r) => ({ ...r, hits: r.hits ?? 0 })),
    }
  }

  setRules(list) {
    const rules = (Array.isArray(list) ? list : []).map((raw) => ({
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID(),
      enabled: raw.enabled !== false,
      name: String(raw.name ?? '').trim() || '未命名规则',
      match: {
        method: String(raw.match?.method ?? '').toUpperCase(),
        host: String(raw.match?.host ?? '').trim(),
        url: String(raw.match?.url ?? '').trim(),
        urlType: ['contains', 'glob', 'regex'].includes(raw.match?.urlType) ? raw.match.urlType : (raw.match?.regex === true ? 'regex' : 'contains'),
      },
      action: {
        type: ['mock', 'delay', 'block', 'rewrite-status'].includes(raw.action?.type) ? raw.action.type : 'mock',
        latencyMs: Math.max(0, Math.min(Number(raw.action?.latencyMs) || 0, 600000)),
        throttleKbps: Math.max(0, Math.min(Number(raw.action?.throttleKbps) || 0, 102400)),
        status: Number.isInteger(raw.action?.status) && raw.action.status >= 100 && raw.action.status <= 599
          ? raw.action.status
          : (raw.action?.type === 'mock' ? 200 : undefined),
        headers: (raw.action?.headers !== null && typeof raw.action?.headers === 'object') ? raw.action.headers : {},
        body: typeof raw.action?.body === 'string' ? raw.action.body : '',
      },
      hits: raw.hits ?? 0,
    }))
    fs.mkdirSync(path.dirname(this.rulesFile), { recursive: true })
    fs.writeFileSync(this.rulesFile, JSON.stringify(rules, null, 2), 'utf8')
    this.rulesCache = { key: 'just-written', rules }
    return this.getRules()
  }

  /** First matching enabled rule for a request, or null. */
  matchRule(req) {
    for (const rule of this.loadRules()) {
      if (rule.enabled === false) continue
      if (matchRule(rule, req)) return rule
    }
    return null
  }

  bumpRule(rule) {
    if (rule === null || rule.id === undefined) return
    rule.hits = (rule.hits ?? 0) + 1
    if (this.rulesFlushTimer === null) {
      this.rulesFlushTimer = setTimeout(() => {
        this.rulesFlushTimer = null
        try {
          fs.writeFileSync(this.rulesFile, JSON.stringify(this.rulesCache.rules, null, 2), 'utf8')
          this.rulesCache = { key: this.rulesFileKey(), rules: this.rulesCache.rules }
        } catch {
          // best effort hit persistence
        }
      }, 500)
    }
    this.rulesCache = { key: 'dirty', rules: this.rulesCache.rules }
  }

  /** Emit a terminal record when forwarding fails before streamResponse can do it. */
  recordForwardError(record, started, error, note) {
    if (record.complete === true) return
    if (!Number.isInteger(record.status)) record.status = 502
    record.complete = true
    record.durationMs = Date.now() - started
    const detail = error instanceof Error ? error.message : String(error)
    record.note = `${note} · 代理错误: ${detail.slice(0, 180)}`
    this.onRecord({ ...record })
  }

  /** Serve a mocked response (AutoResponder 'mock' action). */
  async applyMock(record, rule, res) {
    const action = rule.action
    if (Number(action.latencyMs) > 0) await sleep(action.latencyMs)
    const status = Number.isInteger(action.status) ? action.status : 200
    const headers = { 'content-type': 'application/json; charset=utf-8', ...(action.headers ?? {}) }
    const body = typeof action.body === 'string' ? action.body : ''
    const buf = Buffer.from(body, 'utf8')
    record.status = status
    record.resHeaders = headers
    record.contentType = String(headers['content-type'] ?? '')
    record.resBody = body
    record.bytesRes = buf.length
    record.complete = true
    record.streaming = false
    record.firstByteMs = Number(action.latencyMs) > 0 ? Number(action.latencyMs) : 1
    record.ttfbMs = record.firstByteMs
    record.durationMs = Number(action.latencyMs) || 1
    record.note = `规则 mock: ${rule.name}`
    record.ruleId = rule.id
    this.onRecord({ ...record })
    this.counters.rulesMocks++
    try {
      res.writeHead(status, headers)
      res.end(buf)
    } catch {
      // client gone mid-mock
    }
  }

  // ----------------------------------------------------------- 请求断点
  /** 断点匹配：仅在启用时按方法/URL(子串) 过滤命中。 */
  bpMatch(method, url) {
    if (!this.breakpoints.enabled) return false
    const mf = this.breakpoints.methodFilter
    if (mf !== '' && mf !== String(method).toUpperCase()) return false
    const uf = this.breakpoints.urlFilter
    if (uf !== '' && !String(url).toLowerCase().includes(uf.toLowerCase())) return false
    return true
  }

  /** 挂起一个请求断点，返回用户决定；120s 超时自动放行，避免忘记处理卡死客户端 socket。 */
  waitBreakpoint(phase, data) {
    return new Promise((resolve) => {
      const id = `bp_${this._pauseSeq++}`
      const timer = setTimeout(() => {
        if (this.paused.has(id)) { this.paused.delete(id); resolve({ action: 'continue', edits: null, timedOut: true }) }
      }, 120000)
      this.paused.set(id, { id, phase, data, resolve, timer, createdAt: Date.now() })
    })
  }

  /** 断点配置 + 当前挂起（等待处理）的请求列表。 */
  getBreakpoints() {
    const paused = []
    for (const p of this.paused.values()) {
      paused.push({
        id: p.id, phase: p.phase, createdAt: p.createdAt, method: p.data.method, url: p.data.url,
        reqHeaders: p.data.reqHeaders ?? {}, reqBody: p.data.reqBody ?? '',
      })
    }
    return { config: { ...this.breakpoints }, paused }
  }

  setBreakpoints(cfg) {
    if (cfg !== null && typeof cfg === 'object') {
      if (typeof cfg.enabled === 'boolean') this.breakpoints.enabled = cfg.enabled
      if (typeof cfg.urlFilter === 'string') this.breakpoints.urlFilter = cfg.urlFilter.trim()
      if (typeof cfg.methodFilter === 'string') this.breakpoints.methodFilter = cfg.methodFilter.trim().toUpperCase()
    }
    if (!this.breakpoints.enabled) { for (const id of [...this.paused.keys()]) this.releaseBreakpoint(id, 'continue', null) } // 关闭即全部放行
    return this.getBreakpoints()
  }

  releaseBreakpoint(id, action, edits) {
    const p = this.paused.get(id)
    if (p === undefined) return false
    this.paused.delete(id)
    if (p.timer !== null) clearTimeout(p.timer)
    p.resolve({ action: action === 'drop' ? 'drop' : 'continue', edits: edits ?? null })
    return true
  }

  /** 请求阶段断点：挂起 → 用户改 方法/头/体 放行，或丢弃。返回 { dropped } 或 { dropped:false, method, headers, body }。 */
  async applyRequestBreakpoint({ record, res, started, method, headers, reqBuf }) {
    const decision = await this.waitBreakpoint('request', {
      method, url: record.url,
      reqHeaders: record.reqHeaders ?? stripHopByHop(headers),
      reqBody: record.reqBody ?? '',
    })
    if (decision.action === 'drop') {
      record.status = 0
      record.note = '断点丢弃(请求)'
      record.complete = true
      record.durationMs = Date.now() - started
      this.onRecord({ ...record })
      try { res.destroy() } catch { /* client gone */ }
      return { dropped: true }
    }
    let outMethod = method
    let outHeaders = headers
    let outBody = reqBuf
    const e = decision.edits
    if (e !== null && typeof e === 'object') {
      if (typeof e.method === 'string' && e.method !== '') { outMethod = e.method.toUpperCase(); record.method = outMethod }
      if (e.reqHeaders !== null && typeof e.reqHeaders === 'object') {
        outHeaders = { ...e.reqHeaders } // req.headers 键为小写；forward 内部会再 stripHopByHop
        record.reqHeaders = stripHopByHop(e.reqHeaders)
      }
      if (typeof e.reqBody === 'string') {
        outBody = Buffer.from(e.reqBody, 'utf8')
        record.reqBody = e.reqBody
        outHeaders = { ...outHeaders }
        outHeaders['content-length'] = String(outBody.length) // 同步长度，避免与旧 content-length 不符
      }
    }
    record.note = decision.timedOut ? '断点超时放行' : (e !== null ? '断点放行(请求已改)' : '断点放行')
    return { dropped: false, method: outMethod, headers: outHeaders, body: outBody }
  }

  ensureCa() {
    if (this.ca !== null) return this.ca
    fs.mkdirSync(this.certDir, { recursive: true })
    const keyFile = path.join(this.certDir, 'ca-key.pem')
    const certFile = path.join(this.certDir, 'ca-cert.pem')
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      try {
        this.ca = {
          key: forge.pki.privateKeyFromPem(fs.readFileSync(keyFile, 'utf8')),
          cert: forge.pki.certificateFromPem(fs.readFileSync(certFile, 'utf8')),
        }
        return this.ca
      } catch {
        this.ca = null
      }
    }
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01' + Math.floor(Math.random() * 0xffffffff).toString(16)
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)
    const attrs = [{ name: 'commonName', value: 'dsh-api-visualizer Local CA' }, { name: 'organizationName', value: 'dsh-api-visualizer' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
      { name: 'subjectKeyIdentifier' },
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    fs.writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey), 'utf8')
    fs.writeFileSync(certFile, forge.pki.certificateToPem(cert), 'utf8')
    this.ca = { key: keys.privateKey, cert }
    return this.ca
  }

  hostCert(host) {
    const cached = this.hostCerts.get(host)
    if (cached !== undefined) return cached
    const ca = this.ensureCa()
    const certFile = path.join(this.certDir, 'hosts', `${host.replace(/[^A-Za-z0-9._-]/g, '_')}.pem`)
    let key = null
    let cert = null
    try {
      if (fs.existsSync(certFile)) {
        const pem = fs.readFileSync(certFile, 'utf8')
        cert = forge.pki.certificateFromPem(pem)
        const keyMatch = /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/.exec(pem)
        if (keyMatch !== null) key = forge.pki.privateKeyFromPem(keyMatch[0])
      }
    } catch {
      key = null
      cert = null
    }
    if (key === null || cert === null) {
      const keys = forge.pki.rsa.generateKeyPair(2048)
      cert = forge.pki.createCertificate()
      cert.publicKey = keys.publicKey
      cert.serialNumber = '01' + Math.floor(Math.random() * 0xffffffff).toString(16)
      cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
      cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000)
      cert.setSubject([{ name: 'commonName', value: host }])
      cert.setIssuer(ca.cert.subject.attributes)
      cert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
      ])
      cert.sign(ca.key, forge.md.sha256.create())
      key = keys.privateKey
      try {
        fs.mkdirSync(path.join(this.certDir, 'hosts'), { recursive: true })
        fs.writeFileSync(certFile, forge.pki.privateKeyToPem(key) + forge.pki.certificateToPem(cert), 'utf8')
      } catch {
        // disk cache is best-effort
      }
    }
    const pair = { key, cert }
    this.hostCerts.set(host, pair)
    return pair
  }

  /** Forward one request through the (optional upstream-chained) agent; attaches connect/tls timing to `record`. */
  forward({ secure, host, port, pathname, method, headers, body, record }) {
    const mod = secure ? https : http
    return new Promise((resolve, reject) => {
      const clean = stripHopByHop(headers)
      clean.host = host
      const timing = { t0: Date.now(), connectMs: null, tlsMs: null }
      const req = mod.request({
        host,
        port,
        path: pathname,
        method,
        headers: clean,
        agent: secure ? this.secureAgents : this.agents,
        __timing: timing,
      }, (res) => {
        if (record !== undefined) {
          if (timing.connectMs !== null) record.connectMs = timing.connectMs
          if (timing.tlsMs !== null) record.tlsMs = timing.tlsMs
        }
        resolve({ res, status: res.statusCode, headers: res.headers, timing })
      })
      req.setTimeout(STREAM_IDLE_TIMEOUT, () => req.destroy(new Error('upstream request timeout')))
      req.once('error', reject)
      if (body !== undefined && body.length > 0) req.write(body)
      req.end()
    })
  }

  /** Forward a response while publishing a provisional record and final stream metrics. */
  streamResponse({ record, fwd, res, started, note, rule = null, throttleKbps = 0 }) {
    const fh = stripHopByHop(fwd.headers)
    record.status = fwd.status
    record.resHeaders = fh
    record.contentType = String(fwd.headers['content-type'] ?? '')
    record.firstByteMs = Date.now() - started
    record.ttfbMs = record.firstByteMs
    record.bytesRes = 0
    record.chunkCount = 0
    record.complete = false
    record.streaming = String(fwd.headers['content-type'] ?? '').toLowerCase().includes('text/event-stream') || fwd.headers['content-length'] === undefined
    record.note = note
    // AutoResponder: rewrite-status overrides what the client actually sees
    if (rule !== null && rule.action?.type === 'rewrite-status' && Number.isInteger(rule.action.status)) {
      record.status = rule.action.status
      record.note = `${note} · 规则重写状态: ${rule.name}`
    }
    res.writeHead(record.status ?? fwd.status, fh)
    this.onRecord({ ...record })
    const resChunks = []
    let bufferedBytes = 0
    let lastUpdate = Date.now()
    let idleTimer = null
    let settled = false
    const throttleBps = Math.max(0, Number(throttleKbps) || 0) * 1024 // 带宽限速目标（字节/秒），0=不限
    let throttleT0 = null
    let sentBytes = 0
    const finish = (complete) => {
      if (settled) return
      settled = true
      if (idleTimer !== null) clearTimeout(idleTimer)
      try { res.end() } catch { /* downstream already closed */ }
      record.complete = complete
      record.durationMs = Date.now() - started
      const resText = bodyForStore(Buffer.concat(resChunks), fwd.headers['content-encoding'], fwd.headers['content-type'])
      if (resText !== '') record.resBody = resText
      if (!complete) record.note = `${note} · 流中断`
      this.onRecord({ ...record })
    }
    const armIdle = () => {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        try { fwd.res.destroy(new Error('stream idle timeout')) } catch { /* ignore */ }
        finish(false)
      }, STREAM_IDLE_TIMEOUT)
    }
    armIdle()
    fwd.res.on('data', (chunk) => {
      if (settled) return
      armIdle()
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      record.bytesRes += buf.length
      record.chunkCount += 1
      try { res.write(buf) } catch { finish(false); return }
      if (bufferedBytes < BUFFER_CAP) {
        const keep = Math.min(buf.length, BUFFER_CAP - bufferedBytes)
        if (keep > 0) resChunks.push(buf.subarray(0, keep))
        bufferedBytes += keep
      }
      if (Date.now() - lastUpdate >= STREAM_UPDATE_MS) {
        lastUpdate = Date.now()
        record.durationMs = Date.now() - started
        this.onRecord({ ...record })
      }
      // 带宽限速：按 throttleBps 目标速率，落后于计划时暂停上游读取（背压自然把
      // 下发速率压到目标值），模拟弱网。单次暂停封顶 10s，避免异常卡死。
      if (throttleBps > 0) {
        if (throttleT0 === null) throttleT0 = Date.now()
        sentBytes += buf.length
        const deficit = (sentBytes / throttleBps) * 1000 - (Date.now() - throttleT0)
        if (deficit > 5) {
          fwd.res.pause()
          setTimeout(() => { if (!settled) { try { fwd.res.resume() } catch { /* socket gone */ } } }, Math.min(deficit, 10000))
        }
      }
    })
    fwd.res.once('end', () => finish(true))
    fwd.res.once('aborted', () => finish(false))
    fwd.res.once('error', () => finish(false))
    res.once('close', () => {
      if (!settled && !res.writableEnded) {
        try { fwd.res.destroy() } catch { /* ignore */ }
        finish(false)
      }
    })
  }

  async handlePlain(req, res) {
    let u
    try {
      u = new URL(req.url)
    } catch {
      res.writeHead(400)
      res.end('bad request url')
      return
    }
    const host = u.hostname
    const port = u.port === '' ? 80 : Number(u.port)
    const started = Date.now()
    const record = { id: randomUUID(), ts: started, source: 'proxy', process: 'local-proxy', method: req.method, url: req.url }
    this.counters.requests++
    try {
      const reqChunks = []
      let reqBytes = 0
      let reqBuffered = 0
      req.on('data', (c) => {
        reqBytes += c.length
        if (reqBuffered < BUFFER_CAP) {
          const keep = Math.min(c.length, BUFFER_CAP - reqBuffered)
          if (keep > 0) reqChunks.push(c.subarray(0, keep))
          reqBuffered += keep
        }
      })
      await new Promise((r) => req.on('end', r))
      const reqBuf = Buffer.concat(reqChunks)
      record.bytesReq = reqBytes
      const reqText = bodyForStore(reqBuf, req.headers['content-encoding'], req.headers['content-type'])
      if (reqText !== '') record.reqBody = reqText
      if (Object.keys(stripHopByHop(req.headers)).length > 0) record.reqHeaders = stripHopByHop(req.headers)

      // AutoResponder: intercept before forwarding
      const rule = this.matchRule({ method: req.method, url: record.url, host })
      let ruleNote = null
      if (rule !== null) {
        this.bumpRule(rule)
        this.counters.rulesHits++
        const action = rule.action
        if (action.type === 'mock') {
          await this.applyMock(record, rule, res)
          return
        }
        if (action.type === 'block') {
          record.status = 0
          record.note = `规则阻断: ${rule.name}`
          record.ruleId = rule.id
          record.complete = true
          record.durationMs = Date.now() - started
          this.onRecord({ ...record })
          try { res.destroy() } catch { /* ignore */ }
          return
        }
        if (action.type === 'delay' && Number(action.latencyMs) > 0) {
          await sleep(Number(action.latencyMs))
          ruleNote = `规则延迟 ${action.latencyMs}ms: ${rule.name}`
        }
        record.ruleId = rule.id
      }

      let bp = { dropped: false, method: req.method, headers: req.headers, body: reqBuf }
      if (this.bpMatch(req.method, record.url)) bp = await this.applyRequestBreakpoint({ record, res, started, method: req.method, headers: req.headers, reqBuf })
      if (bp.dropped) return
      const fwd = await this.forward({
        secure: u.protocol === 'https:',
        host,
        port,
        pathname: u.pathname + u.search,
        method: bp.method,
        headers: bp.headers,
        body: bp.body,
        record,
      })
      await this.streamResponse({ record, fwd, res, started, note: record.note ?? ruleNote ?? '本地代理捕获', rule: rule?.action?.type === 'rewrite-status' ? rule : null, throttleKbps: rule?.action?.throttleKbps || 0 })
    } catch (error) {
      this.counters.errors++
      this.recordForwardError(record, started, error, '本地代理捕获')
      try {
        if (!res.headersSent) {
          res.writeHead(502)
          res.end('proxy error')
        } else {
          res.end()
        }
      } catch {
        // ignore teardown races
      }
    }
  }

  async handleTunneledRequest(host, port, req, res) {
    const started = Date.now()
    const record = {
      id: randomUUID(),
      ts: started,
      source: 'proxy',
      process: 'local-proxy',
      method: req.method,
      url: `https://${host}${port === 443 ? '' : ':' + port}${req.url}`,
    }
    this.counters.requests++
    this.counters.mitm++
    try {
      const reqChunks = []
      let reqBytes = 0
      let reqBuffered = 0
      req.on('data', (c) => {
        reqBytes += c.length
        if (reqBuffered < BUFFER_CAP) {
          const keep = Math.min(c.length, BUFFER_CAP - reqBuffered)
          if (keep > 0) reqChunks.push(c.subarray(0, keep))
          reqBuffered += keep
        }
      })
      await new Promise((r) => req.on('end', r))
      const reqBuf = Buffer.concat(reqChunks)
      record.bytesReq = reqBytes
      const reqText = bodyForStore(reqBuf, req.headers['content-encoding'], req.headers['content-type'])
      if (reqText !== '') record.reqBody = reqText
      if (Object.keys(stripHopByHop(req.headers)).length > 0) record.reqHeaders = stripHopByHop(req.headers)

      // AutoResponder: intercept before forwarding
      const rule = this.matchRule({ method: req.method, url: record.url, host })
      let ruleNote = null
      if (rule !== null) {
        this.bumpRule(rule)
        this.counters.rulesHits++
        const action = rule.action
        if (action.type === 'mock') {
          await this.applyMock(record, rule, res)
          return
        }
        if (action.type === 'block') {
          record.status = 0
          record.note = `规则阻断: ${rule.name}`
          record.ruleId = rule.id
          record.complete = true
          record.durationMs = Date.now() - started
          this.onRecord({ ...record })
          try { res.destroy() } catch { /* ignore */ }
          return
        }
        if (action.type === 'delay' && Number(action.latencyMs) > 0) {
          await sleep(Number(action.latencyMs))
          ruleNote = `规则延迟 ${action.latencyMs}ms: ${rule.name}`
        }
        record.ruleId = rule.id
      }

      let bp = { dropped: false, method: req.method, headers: req.headers, body: reqBuf }
      if (this.bpMatch(req.method, record.url)) bp = await this.applyRequestBreakpoint({ record, res, started, method: req.method, headers: req.headers, reqBuf })
      if (bp.dropped) return
      const fwd = await this.forward({
        secure: true,
        host,
        port: port === 443 ? 443 : port,
        pathname: req.url,
        method: bp.method,
        headers: bp.headers,
        body: bp.body,
        record,
      })
      await this.streamResponse({ record, fwd, res, started, note: record.note ?? ruleNote ?? '本地代理捕获(HTTPS 解密)', rule: rule?.action?.type === 'rewrite-status' ? rule : null, throttleKbps: rule?.action?.throttleKbps || 0 })
    } catch (error) {
      this.counters.errors++
      this.recordForwardError(record, started, error, '本地代理捕获(HTTPS 解密)')
      console.error('[proxy-engine] https forward error:', error instanceof Error ? error.message : String(error))
      try {
        if (!res.headersSent) {
          res.writeHead(502)
          res.end('proxy error')
        } else {
          res.end()
        }
      } catch {
        // ignore
      }
    }
  }

  handleConnect(req, clientSocket, head) {
    const target = String(req.url ?? '')
    const [hostPart, portPart] = target.split(':')
    const host = hostPart
    const port = Number(portPart) || 443
    if (!host || host === '') {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      clientSocket.destroy()
      return
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: dsh-api-visualizer\r\n\r\n')
    try {
      const pair = this.hostCert(host)
      const secureContext = tls.createSecureContext({
        key: forge.pki.privateKeyToPem(pair.key),
        cert: forge.pki.certificateToPem(pair.cert),
      })
      const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, secureContext })
      tlsSocket.once('error', () => {
        this.counters.errors++
        tlsSocket.destroy()
      })
      const mini = http.createServer((req, res) => {
        this.handleTunneledRequest(host, port, req, res).catch(() => {})
      })
      mini.on('upgrade', (req, socket, head) => this.handleWsUpgrade(req, socket, head, { tunnel: true, host, port }))
      mini.on('clientError', () => {})
      mini.emit('connection', tlsSocket)
      if (head !== undefined && head.length > 0) tlsSocket.unshift(head)
    } catch (error) {
      this.counters.errors++
      clientSocket.destroy()
    }
  }

  /**
   * WebSocket capture: rebuild the upgrade request, tunnel it, and tap frames
   * in both directions (client frames are masked, server frames are not).
   * Records one entry per connection (method=WS) plus per-frame metadata.
   */
  handleWsUpgrade(req, socket, head, ctx = null) {
    const started = Date.now()
    let u
    try {
      u = new URL(req.url, ctx !== null && ctx.tunnel ? `https://${ctx.host}` : 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    const host = ctx !== null && ctx.tunnel ? ctx.host : u.hostname
    const port = ctx !== null && ctx.tunnel ? ctx.port : (u.port === '' ? 80 : Number(u.port))
    const secure = ctx !== null && ctx.tunnel
    const defaultPort = secure ? 443 : 80
    const wsUrl = `${secure ? 'wss' : 'ws'}://${host}${port === defaultPort ? '' : ':' + port}${u.pathname}${u.search}`
    const record = {
      id: randomUUID(),
      ts: started,
      source: 'proxy',
      process: 'local-proxy',
      method: 'WS',
      url: wsUrl,
      ws: { frames: { c2s: [], s2c: [] }, closeCode: null, closeReason: '', frameCount: null, msgCount: null },
    }
    this.counters.requests++
    const reqHeaders = {}
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      if (WS_DROP_HEADERS.has(String(k).toLowerCase())) continue
      reqHeaders[k] = v
    }
    record.reqHeaders = reqHeaders
    const headLines = [`${req.method} ${ctx !== null && ctx.tunnel ? u.pathname + u.search : (u.pathname || '/') + u.search} HTTP/1.1`]
    for (const [k, v] of Object.entries(reqHeaders)) headLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    const headBuf = Buffer.from(headLines.join('\r\n') + '\r\n\r\n', 'latin1')

    const timing = { t0: started, connectMs: null, tlsMs: null }
    tunnelConnect({ upstream: this.upstream, host, port, secure }, (error, up) => {
      if (error !== null) {
        record.status = 502
        record.note = `WebSocket 连接失败: ${error instanceof Error ? error.message : String(error)}`
        record.complete = true
        this.onRecord({ ...record })
        try {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        } catch {
          // ignore
        }
        socket.destroy()
        return
      }
      if (timing.connectMs !== null) record.connectMs = timing.connectMs
      if (timing.tlsMs !== null) record.tlsMs = timing.tlsMs
      up.write(headBuf)
      if (head !== undefined && head.length > 0) up.write(head)

      let reqText = ''
      let resText = ''
      const pushText = (into, t) => {
        if (t === '') return into
        into += t
        if (into.length > 2 * 1024 * 1024) into = into.slice(0, 2 * 1024 * 1024)
        return into
      }
      const c2sParser = new WsFrameParser({ masked: true, onText: (t) => { reqText = pushText(reqText, t) } })
      const s2cParser = new WsFrameParser({ masked: false, onText: (t) => { resText = pushText(resText, t) } })
      let bytesReq = 0
      let bytesRes = 0
      let provisionalSent = false
      let settled = false
      let upBuf = Buffer.alloc(0)

      // Node puts bytes received after the Upgrade headers in `head`.
      // They are already forwarded above, but must also enter capture metrics.
      if (head !== undefined && head.length > 0) {
        bytesReq += head.length
        c2sParser.feed(head)
      }

      const finish = (complete) => {
        if (settled) return
        settled = true
        try {
          up.destroy()
        } catch {
          // ignore
        }
        try {
          socket.destroy()
        } catch {
          // ignore
        }
        const closedCleanly = c2sParser.closeCode !== null || s2cParser.closeCode !== null
        record.complete = complete || closedCleanly
        record.durationMs = Date.now() - started
        record.bytesReq = bytesReq
        record.bytesRes = bytesRes
        record.chunkCount = c2sParser.frameCount + s2cParser.frameCount
        record.streaming = true
        record.ws.frames = { c2s: c2sParser.frames, s2c: s2cParser.frames }
        record.ws.closeCode = s2cParser.closeCode ?? c2sParser.closeCode
        record.ws.closeReason = s2cParser.closeReason || c2sParser.closeReason
        record.ws.frameCount = { c2s: c2sParser.frameCount, s2c: s2cParser.frameCount }
        record.ws.msgCount = { c2s: c2sParser.msgCount, s2c: s2cParser.msgCount }
        if (reqText !== '') record.reqBody = reqText
        if (resText !== '') record.resBody = resText
        record.note = `WebSocket 捕获 · ${record.chunkCount} 帧 (c2s ${c2sParser.frameCount} / s2c ${s2cParser.frameCount})` + (record.complete ? '' : ' · 连接中断')
        this.onRecord({ ...record })
      }
      const sendUp = (buf) => {
        try {
          up.write(buf)
          return true
        } catch {
          finish(false)
          return false
        }
      }
      const sendClient = (buf) => {
        try {
          socket.write(buf)
          return true
        } catch {
          finish(false)
          return false
        }
      }

      // client → server (masked frames)
      socket.on('data', (d) => {
        if (settled) return
        bytesReq += d.length
        c2sParser.feed(d)
        sendUp(d)
      })
      socket.once('close', () => finish(false))
      socket.once('error', () => finish(false))

      // server → client (unmasked); first chunk carries the 101 head
      const onServerData = (d) => {
        if (settled) return
        s2cParser.feed(d)
        sendClient(d)
      }
      up.on('data', (d) => {
        if (settled) return
        bytesRes += d.length
        if (!provisionalSent) {
          upBuf = Buffer.concat([upBuf, d])
          const idx = upBuf.indexOf('\r\n\r\n')
          if (idx < 0) return
          const headText = upBuf.subarray(0, idx).toString('latin1')
          const rest = upBuf.subarray(idx + 4)
          const lines = headText.split('\r\n')
          const status = Number.parseInt(lines[0].split(' ')[1], 10) || 101
          const resHeaders = {}
          for (const l of lines.slice(1)) {
            const m = /^([^:]+):\s?(.*)$/.exec(l)
            if (m !== null) resHeaders[m[1].toLowerCase()] = m[2]
          }
          record.status = status
          record.resHeaders = resHeaders
          record.contentType = String(resHeaders['content-type'] ?? '')
          record.firstByteMs = Date.now() - started
          record.ttfbMs = record.firstByteMs
          record.complete = false
          record.note = 'WebSocket 捕获'
          this.onRecord({ ...record })
          this.counters.ws++
          provisionalSent = true
          if (!sendClient(upBuf.subarray(0, idx + 4))) return
          if (rest.length > 0) onServerData(rest)
          return
        }
        onServerData(d)
      })
      up.once('close', () => finish(true))
      up.once('error', () => finish(false))
    }, timing)
  }

  async start({ port = this.port, upstream } = {}) {
    if (this.server !== null) return this.status()
    this.port = port
    this.lastError = null
    this.startedAt = null
    this.counters = { requests: 0, mitm: 0, errors: 0, ws: 0, rulesHits: 0, rulesMocks: 0 }
    if (upstream === undefined || upstream === 'auto') {
      // not specified → re-read the system proxy on every start (never inherit the previous run's mode)
      const sys = readSystemProxy()
      this.upstream = sys.enable && sys.server !== '' ? parseUpstream(sys.server) : null
    } else {
      this.upstream = upstream === null || upstream === '' ? null : parseUpstream(upstream)
    }
    this.ensureCa()
    this.agents = new ForwardAgent({ upstream: this.upstream })
    this.secureAgents = new SecureForwardAgent({ upstream: this.upstream })
    const server = http.createServer((req, res) => {
      this.handlePlain(req, res).catch(() => {})
    })
    this.server = server
    server.on('connect', (req, socket, head) => this.handleConnect(req, socket, head))
    server.on('upgrade', (req, socket, head) => this.handleWsUpgrade(req, socket, head))
    server.on('clientError', (error, socket) => {
      this.counters.errors++
      socket.destroy()
    })
    server.on('error', (error) => {
      this.counters.errors++
      this.lastError = error instanceof Error ? error.message : String(error)
      if (this.server === server) {
        this.server = null
        this.startedAt = null
        if (this.agents != null) { this.agents.destroy(); this.agents = null }
        if (this.secureAgents != null) { this.secureAgents.destroy(); this.secureAgents = null }
      }
    })
    await new Promise((resolve, reject) => {
      const onListening = () => {
        server.removeListener('error', onStartError)
        this.startedAt = Date.now()
        resolve()
      }
      const onStartError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      server.once('listening', onListening)
      server.once('error', onStartError)
      server.listen(port, '127.0.0.1')
    })
    return this.status()
  }

  stop() {
    for (const id of [...this.paused.keys()]) this.releaseBreakpoint(id, 'continue', null) // 停代理前放行所有挂起
    if (this.rulesFlushTimer !== null) {
      clearTimeout(this.rulesFlushTimer)
      this.rulesFlushTimer = null
      if (this.rulesCache.key === 'dirty') {
        try {
          fs.writeFileSync(this.rulesFile, JSON.stringify(this.rulesCache.rules, null, 2), 'utf8')
          this.rulesCache = { key: this.rulesFileKey(), rules: this.rulesCache.rules }
        } catch { /* best effort */ }
      }
    }
    if (this.server !== null) {
      this.server.close()
      this.server = null
    }
    if (this.agents != null) {
      this.agents.destroy()
      this.agents = null
    }
    if (this.secureAgents != null) {
      this.secureAgents.destroy()
      this.secureAgents = null
    }
    this.startedAt = null
    return this.status()
  }

  status() {
    const rules = this.getRules()
    return {
      running: this.server !== null,
      port: this.port,
      upstream: this.upstream === null || this.upstream === undefined ? null : `${this.upstream.host}:${this.upstream.port}`,
      caPath: path.join(this.certDir, 'ca-cert.pem'),
      caReady: this.ca !== null || fs.existsSync(path.join(this.certDir, 'ca-cert.pem')),
      systemProxyActive: this.systemProxyEnabled(),
      counters: { ...this.counters },
      startedAt: this.startedAt ?? null,
      error: this.lastError,
      rules: { total: rules.total, enabled: rules.enabled },
    }
  }

  systemProxyEnabled() {
    const sys = readSystemProxy()
    return sys.enable && sys.server.includes(String(this.port))
  }

  /** Export the CA cert as DER for Windows import. */
  exportCaDer() {
    const ca = this.ensureCa()
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(ca.cert)).getBytes()
    const file = path.join(this.certDir, 'ca-cert.der')
    fs.writeFileSync(file, Buffer.from(der, 'binary'))
    return file
  }

  /** Import the CA into CurrentUser\Root (no admin required). */
  installCa() {
    return new Promise((resolve) => {
      const der = this.exportCaDer()
      execFile('certutil.exe', ['-user', '-addstore', 'Root', der], { encoding: 'utf8' }, (error, stdout) => {
        const ok = error === null || /成功|already|CertUtil/.test(stdout ?? '')
        resolve({ ok: ok || String(stdout ?? '').includes('成功'), output: (stdout ?? '').trim().slice(0, 400) })
      })
    })
  }

  /** Point (or restore) the WinINET system proxy at this engine. */
  async setSystemProxy(enable) {
    if (enable) {
      if (this.server === null) throw new Error('proxy not running')
      if (this.backupSystemProxy === null) {
        this.backupSystemProxy = readSystemProxy()
        const backupFile = path.join(this.certDir, 'sysproxy-backup.json')
        try {
          if (!fs.existsSync(backupFile)) {
            fs.writeFileSync(backupFile, JSON.stringify(this.backupSystemProxy), 'utf8')
          } else {
            this.backupSystemProxy = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
          }
        } catch {
          // best-effort
        }
      }
      const override = this.backupSystemProxy.override ?? '<local>'
      await writeSystemProxy({ enable: true, server: `127.0.0.1:${this.port}`, override })
      await refreshWinInet()
      return { enabled: true, server: `127.0.0.1:${this.port}` }
    }
    const backupFile = path.join(this.certDir, 'sysproxy-backup.json')
    let backup = this.backupSystemProxy
    if (backup === null) {
      try {
        if (fs.existsSync(backupFile)) backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
      } catch {
        backup = null
      }
    }
    if (backup === null || backup.server === '') {
      await writeSystemProxy({ enable: false, server: '', override: '' })
    } else {
      await writeSystemProxy({ enable: backup.enable, server: backup.server, override: backup.override ?? '' })
    }
    await refreshWinInet()
    return { enabled: false, restored: backup }
  }
}
