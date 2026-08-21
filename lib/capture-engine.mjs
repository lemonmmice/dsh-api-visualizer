/**
 * dsh-api-visualizer — realtime capture engine (Fiddler-style).
 *
 * Tails the client process's System.Net trace log (written by the
 * <system.diagnostics> config injection) and turns raw trace lines into
 * API-call records: method / absolute url / status / req+res headers /
 * req+res bodies (gzip responses are decompressed).
 *
 * The trace log is multi-threaded, so the parser keeps per-thread state and
 * joins request <-> response via the Connection# / HttpWebRequest# /
 * ConnectStream# ids the runtime prints. No client code changes: this reads
 * the same log file the existing net-trace setup already produces.
 *
 * Records flow through the `onRecord` callback; the host plugin feeds them
 * into the JSONL store directly, and the standalone runner POSTs them to
 * the loopback /api/dsh-api-visualizer/ingest route.
 */

import { openSync, closeSync, readSync, statSync, realpathSync } from 'node:fs'
import { gunzipSync, inflateSync, inflateRawSync, brotliDecompressSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Default trace log written by the client's injected system.diagnostics. */
export const DEFAULT_LOG = join(process.env.TEMP || process.env.TMP || tmpdir(), 'uiprobe-net-trace.log')

/** Soft cap on pending (unfinished) requests. */
const MAX_PENDING = 1000
/** Drop pending requests that never receive a status line after this long. */
const STALE_MS = 45 * 1000
/** Body attach cap per field (2MB — Fiddler-like full bodies for normal API payloads). */
const BODY_CAP = 2 * 1024 * 1024

const HEX_LINE = /^System\.Net Verbose: 0 : \[(\d+)\] [0-9A-F]{8} : (.+)$/

/** Extract the hex byte pairs from one trace hex-dump line (stops at the ascii column). */
function hexBytes(line) {
  const m = HEX_LINE.exec(line)
  if (m === null) return null
  const hexPart = m[2].split(':')[0]
  const pairs = hexPart.match(/[0-9A-F]{2}/g)
  if (pairs === null) return null
  return Buffer.from(pairs.map((p) => Number.parseInt(p, 16)))
}

/** Decompress a (possibly multi-member / trailing-junk) gzip buffer. */
function tryGunzip(buf) {
  if (buf.length < 10 || buf[0] !== 0x1f || buf[1] !== 0x8b) return null
  // Concatenated members: gunzip each 1F 8B .. segment and join.
  const starts = []
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0x1f && buf[i + 1] === 0x8b && buf[i + 2] === 0x08) starts.push(i)
  }
  if (starts.length === 0) return null
  const parts = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      parts.push(gunzipSync(buf.subarray(starts[i], end)))
    } catch {
      if (i === 0) {
        try {
          return gunzipSync(buf)
        } catch {
          return null
        }
      }
    }
  }
  if (parts.length === 0) return null
  return Buffer.concat(parts)
}

/** Case-insensitive header lookup (trace keeps the wire casing). */
function headerGet(headers, name) {
  if (headers === null || headers === undefined) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : headers[key]
}

/** Charset from a content-type value, or null. */
function charsetOf(contentType) {
  if (typeof contentType !== 'string') return null
  const m = /charset=["']?([\w-]+)/i.exec(contentType)
  return m === null ? null : m[1].toLowerCase()
}

/** Decode a body per content-encoding: gzip / deflate / br, else passthrough. */
function decodeContent(buf, encoding) {
  const enc = String(encoding ?? '').toLowerCase()
  if (enc.includes('gzip')) return tryGunzip(buf)
  if (enc.includes('deflate')) {
    try {
      return inflateSync(buf)
    } catch {
      try {
        return inflateRawSync(buf)
      } catch {
        return null
      }
    }
  }
  if (enc.includes('br')) {
    try {
      return brotliDecompressSync(buf)
    } catch {
      return null
    }
  }
  return buf
}

/**
 * Best-effort body from raw wire bytes.
 * Text payloads decode with the declared charset (GBK/GB2312 supported via
 * full-ICU TextDecoder); images store as `base64:<mime>;<data>`; other binary
 * stores as `hex:<dump>` so the panel can offer image/hex views.
 */
function bodyText(chunks, encoding, contentType) {
  if (chunks.length === 0) return ''
  const buf = Buffer.concat(chunks)
  const unzipped = decodeContent(buf, encoding)
  const raw = unzipped === null ? buf : unzipped
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.includes('image/')) {
    if (raw.length > 0 && raw.length <= 1.5 * 1024 * 1024) {
      const mime = ct.split(';')[0].trim()
      return `base64:${mime};${raw.toString('base64')}`
    }
    return ''
  }
  const charset = charsetOf(contentType)
  let text
  try {
    text = new TextDecoder(charset ?? 'utf-8').decode(raw)
  } catch {
    text = raw.toString('utf8')
  }
  // Drop control-char heavy (binary) payloads — offer a hex dump instead.
  let control = 0
  for (let i = 0; i < Math.min(text.length, 512); i++) {
    const c = text.charCodeAt(i)
    if (c < 9 || (c > 13 && c < 32)) control++
  }
  if (control > 16 && !text.startsWith('{') && !text.startsWith('[')) {
    const cap = Math.min(raw.length, 64 * 1024)
    return 'hex:' + raw.subarray(0, cap).toString('hex')
  }
  if (text.length > BODY_CAP) text = text.slice(0, BODY_CAP) + '…(截断)'
  return text
}

/** Incremental parser over the trace log text. */
export class TraceParser {
  constructor({ onRecord = () => {}, now = () => Date.now() } = {}) {
    this.onRecord = onRecord
    this.now = now
    this.counters = { lines: 0, requestsSeen: 0, emitted: 0, droppedNoStatus: 0, droppedStale: 0, bodies: 0 }
    this.pending = new Map() // reqId -> rec
    this.connToReq = new Map() // connId -> reqId
    this.streamToReq = new Map() // streamId -> reqId
    this.respToReq = new Map() // respId -> reqId
    this.threadState = new Map() // threadId -> { createUrl, readStream, writeStream, headerCtx }
    this.activeHeaderThread = null // thread whose header block the bare { }。 / "K: v" lines belong to
    this.lastFlush = this.now()
  }

  state(thread) {
    let s = this.threadState.get(thread)
    if (s === undefined) {
      s = { createUrl: null, readStream: null, writeStream: null, headerCtx: null }
      this.threadState.set(thread, s)
    }
    return s
  }

  ensure(reqId) {
    let rec = this.pending.get(reqId)
    if (rec === undefined) {
      rec = {
        url: null, method: '', path: '', seenAt: this.now(),
        reqHeaders: {}, resHeaders: {}, reqChunks: [], resChunks: [], status: undefined,
        startTicks: null,
      }
      this.pending.set(reqId, rec)
      this.counters.requestsSeen++
      if (this.pending.size > MAX_PENDING) {
        const oldest = this.pending.keys().next().value
        this.pending.delete(oldest)
        this.counters.droppedStale++
      }
    }
    return rec
  }

  /** Ticks (100ns) of one event line — null when the log has no Timestamp lines. */
  ticksOf(ts) {
    return ts !== null && ts !== undefined && Number.isFinite(ts) ? ts : null
  }

  finalize(rec, reason) {
    this.pending.delete(rec.reqIdForDelete)
    if (rec.status === undefined) {
      this.counters.droppedNoStatus++
      return
    }
    let url = rec.url
    if (url === null || url === '') {
      const host = (rec.reqHeaders.host ?? rec.reqHeaders.Host ?? '')
      url = host !== '' && rec.path !== '' ? `https://${host}${rec.path}` : rec.path
    }
    if (url === '' || url === null) {
      this.counters.droppedNoStatus++
      return
    }
    const record = {
      ts: this.now(),
      source: 'realtime',
      method: rec.method.toUpperCase(),
      url,
      status: rec.status,
    }
    // Ticks(100ns) → ms, from the Timestamp= lines the listener now emits.
    if (rec.startTicks !== null && rec.endTicks !== undefined && rec.endTicks > rec.startTicks) {
      const ms = Math.round((rec.endTicks - rec.startTicks) / 10000)
      if (ms > 0 && ms < 3600000) record.durationMs = ms
    }
    if (Object.keys(rec.reqHeaders).length > 0) record.reqHeaders = rec.reqHeaders
    if (Object.keys(rec.resHeaders).length > 0) record.resHeaders = rec.resHeaders
    const reqBody = bodyText(rec.reqChunks, headerGet(rec.reqHeaders, 'content-encoding'), headerGet(rec.reqHeaders, 'content-type'))
    if (reqBody !== '') record.reqBody = reqBody
    const resBody = bodyText(rec.resChunks, headerGet(rec.resHeaders, 'content-encoding'), headerGet(rec.resHeaders, 'content-type'))
    if (resBody !== '') {
      record.resBody = resBody
      this.counters.bodies++
    }
    record.note = `实时捕获 · ${reason ?? '完成'}`
    this.counters.emitted++
    this.onRecord(record)
  }

  flushStale() {
    const now = this.now()
    if (now - this.lastFlush < 5000) return
    this.lastFlush = now
    for (const [reqId, rec] of this.pending) {
      if (now - rec.seenAt > STALE_MS) {
        rec.reqIdForDelete = reqId
        this.finalize(rec, '超时无状态')
      }
    }
  }

  /** Feed one raw trace line. */
  line(text, ts) {
    this.counters.lines++
    const t = text.trim()
    if (t === '') return
    const ticks = this.ticksOf(ts)

    const m = /^System\.Net (Verbose|Information): \d+ : \[(\d+)\] (.*)$/.exec(t)

    // Bare lines: header-block content ({ / }。 / "Key: value"). They follow
    // the thread that just printed the "正在发送标头" / "已收到标头" marker.
    if (m === null) {
      const th = this.activeHeaderThread
      if (th !== null && th !== undefined) {
        const st = this.state(th)
        const ctx = st.headerCtx
        if (ctx !== null) {
          if (t === '}。' || t === '}') {
            st.headerCtx = null
            if (ctx.type === 'res') {
              const rec = this.pending.get(this.connToReq.get(ctx.connId))
              if (rec !== undefined && ctx.headers !== undefined) rec.resHeaders = ctx.headers
            }
            return
          }
          if (t !== '{') {
            const hr = /^([A-Za-z0-9-]+):\s?(.*)$/.exec(t)
            if (hr !== null) {
              if (ctx.type === 'req') ctx.rec.reqHeaders[hr[1]] = hr[2]
              else if (ctx.headers !== undefined) ctx.headers[hr[1]] = hr[2]
            }
            return
          }
          return
        }
      }
      // fallback: response close without the "Entering" prefix
      const r2 = /^Exiting HttpWebResponse#(\d+)::Close\(\)/.exec(t)
      if (r2 !== null) {
        const reqId = this.respToReq.get(r2[1])
        const rec = reqId !== undefined ? this.pending.get(reqId) : undefined
        if (rec !== undefined && rec.status !== undefined) {
          if (rec.endTicks === undefined && ticks !== null) rec.endTicks = ticks
          rec.reqIdForDelete = reqId
          this.finalize(rec)
        }
      }
      return
    }

    const thread = m[2]
    const body = m[3]
    const st = this.state(thread)

    // hex dump (request write / response read bodies)
    const hb = hexBytes(t)
    if (hb !== null) {
      if (st.readStream !== null) {
        const rec = this.pending.get(this.streamToReq.get(st.readStream))
        if (rec !== undefined) rec.resChunks.push(hb)
      } else if (st.writeStream !== null) {
        const rec = this.pending.get(this.streamToReq.get(st.writeStream))
        if (rec !== undefined) rec.reqChunks.push(hb)
      }
      return
    }

    let r
    // request creation
    r = /^Entering WebRequest::Create\(([^)]+)\)/.exec(body)
    if (r !== null) {
      st.createUrl = r[1]
      return
    }
    r = /^Entering HttpWebRequest#(\d+)::HttpWebRequest\(([^)]+)\)/.exec(body)
    if (r !== null) {
      const rec = this.ensure(r[1])
      const url = r[2].replace(/#-\d+$/, '')
      if (rec.url === null) rec.url = url
      return
    }
    r = /^Exiting WebRequest::Create\(\).*-> HttpWebRequest#(\d+)/.exec(body)
    if (r !== null) {
      const rec = this.ensure(r[1])
      if (rec.url === null && st.createUrl !== null) rec.url = st.createUrl
      st.createUrl = null
      return
    }
    // request line: opens the request-header block
    r = /^HttpWebRequest#(\d+) - Request: (\S+) (\S+) HTTP/.exec(body)
    if (r !== null) {
      const rec = this.ensure(r[1])
      rec.method = r[2]
      rec.path = r[3]
      if (rec.startTicks === null && ticks !== null) rec.startTicks = ticks
      st.headerCtx = { type: 'req', rec }
      this.activeHeaderThread = thread
      return
    }
    // response headers context ("Connection#N - 已收到标头")
    r = /^Connection#(\d+) - 已收到标头/.exec(body)
    if (r !== null) {
      st.headerCtx = { type: 'res', connId: r[1], headers: {} }
      this.activeHeaderThread = thread
      return
    }
    // body stream markers
    r = /^Data from ConnectStream#(\d+)::Write/.exec(body)
    if (r !== null) {
      st.writeStream = r[1]
      return
    }
    r = /^Data from ConnectStream#(\d+)::Read/.exec(body)
    if (r !== null) {
      st.readStream = r[1]
      return
    }
    r = /^Exiting ConnectStream#(\d+)::(Write|Read)/.exec(body)
    if (r !== null) {
      if (r[2] === 'Write') st.writeStream = null
      else st.readStream = null
      return
    }
    // associations
    r = /^Associating Connection#(\d+) with HttpWebRequest#(\d+)/.exec(body)
    if (r !== null) {
      this.connToReq.set(r[1], r[2])
      return
    }
    r = /^Associating HttpWebRequest#(\d+) with ConnectStream#(\d+)/.exec(body)
    if (r !== null) {
      this.streamToReq.set(r[2], r[1])
      return
    }
    r = /^Associating HttpWebRequest#(\d+) with HttpWebResponse#(\d+)/.exec(body)
    if (r !== null) {
      this.respToReq.set(r[2], r[1])
      return
    }
    // status line
    r = /^Connection#(\d+) - .*StatusCode=(\d+)/.exec(body)
    if (r !== null) {
      const rec = this.pending.get(this.connToReq.get(r[1]))
      if (rec !== undefined && rec.status === undefined) rec.status = Number.parseInt(r[2], 10)
      return
    }
    // response close = request finished
    r = /^Entering HttpWebResponse#(\d+)::Close\(\)/.exec(body)
    if (r !== null) {
      const reqId = this.respToReq.get(r[1])
      const rec = reqId !== undefined ? this.pending.get(reqId) : undefined
      if (rec !== undefined && rec.status !== undefined) {
        if (rec.endTicks === undefined && ticks !== null) rec.endTicks = ticks
        rec.reqIdForDelete = reqId
        this.finalize(rec)
      }
    }
  }

  /** Feed a chunk of raw log text (each event line is followed by a blank line then its Timestamp= line). */
  feed(chunk) {
    const text = (this.holdLine ?? '') + chunk
    const lines = text.split(/\r?\n/)
    // 末行若不是空行/Timestamp 行，说明它后面的 Timestamp 还没到 → 留到下一块再配对
    const last = lines.pop() ?? ''
    if (last !== '' && !/^\s*Timestamp=/.test(last)) {
      this.holdLine = last
    } else {
      this.holdLine = ''
      if (last !== '') lines.push(last)
    }
    for (let i = 0; i < lines.length; i++) {
      let ts = null
      let next = null
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        if (lines[j].trim() === '') continue
        next = lines[j]
        break
      }
      if (next === null && this.holdLine !== '' && /^\s*Timestamp=/.test(this.holdLine)) next = this.holdLine
      if (next !== null) {
        const tm = /^\s*Timestamp=(\d+)/.exec(next)
        if (tm !== null) ts = Number(tm[1])
      }
      this.line(lines[i], ts)
    }
    this.flushStale()
  }
}

/** File tailer: emits appended trace text via onChunk; resilient to rotation. */
export class LogTailer {
  constructor({ logPath, pollMs = 750, replay = false, onChunk = () => {} }) {
    this.logPath = logPath
    this.pollMs = pollMs
    this.onChunk = onChunk
    this.offset = 0
    this.startedAt = null
    this.initialSize = null
    this.replay = replay
    this.timer = null
    this.errors = 0
  }

  start() {
    if (this.timer !== null) return
    try {
      const st = statSync(this.logPath)
      this.initialSize = st.size
      if (!this.replay) this.offset = st.size
    } catch {
      this.offset = 0
      this.initialSize = 0
    }
    this.startedAt = Date.now()
    let remainder = '' // 未完整的行尾：hex 行被切在块边界时先拼回完整行
    const poll = () => {
      try {
        const st = statSync(this.logPath)
        if (st.size < this.offset) {
          this.offset = 0 // rotated / cleared
          remainder = ''
        }
        if (st.size > this.offset) {
          const fd = openSync(this.logPath, 'r')
          try {
            const size = st.size - this.offset
            const buf = Buffer.alloc(size)
            readSync(fd, buf, 0, size, this.offset)
            this.offset = st.size
            const data = remainder + buf.toString('utf8')
            const idx = data.lastIndexOf('\n')
            if (idx === -1) {
              remainder = data
            } else {
              remainder = data.slice(idx + 1)
              this.onChunk(data.slice(0, idx + 1))
            }
          } finally {
            closeSync(fd)
          }
        }
      } catch {
        this.errors++
      }
    }
    poll()
    this.timer = setInterval(poll, this.pollMs)
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  status() {
    let size = null
    let exists = false
    try {
      const st = statSync(this.logPath)
      size = st.size
      exists = true
    } catch {
      // log file not present (trace config not injected yet)
    }
    return {
      running: this.timer !== null,
      logPath: this.logPath,
      logExists: exists,
      logSize: size,
      offset: this.offset,
      replay: this.replay,
      startedAt: this.startedAt,
      errors: this.errors,
    }
  }
}

/** Full engine: tailer + parser + record callback. */
export class CaptureEngine {
  constructor({ logPath = DEFAULT_LOG, pollMs = 750, replay = false, onRecord = () => {} } = {}) {
    this.parser = new TraceParser({ onRecord })
    this.tailer = new LogTailer({
      logPath,
      pollMs,
      replay,
      onChunk: (chunk) => this.parser.feed(chunk),
    })
  }

  start() {
    this.tailer.start()
  }

  stop() {
    this.tailer.stop()
  }

  status() {
    return { ...this.tailer.status(), counters: { ...this.parser.counters } }
  }
}

/** Standalone runner: tail the log and POST batches to the loopback ingest route. */
async function runStandalone() {
  const logPath = process.env.DSH_CAPTURE_LOG ?? DEFAULT_LOG
  const ingest = process.env.DSH_CAPTURE_INGEST ?? 'http://127.0.0.1:3080/api/dsh-api-visualizer/ingest'
  const replay = process.env.DSH_CAPTURE_REPLAY === '1'
  const flushMs = Number(process.env.DSH_CAPTURE_FLUSH_MS ?? 800)

  let queue = []
  let sending = false
  const engine = new CaptureEngine({
    logPath,
    replay,
    onRecord: (rec) => {
      queue.push(rec)
      if (queue.length >= 20 && !sending) void flush()
    },
  })
  async function flush() {
    if (sending || queue.length === 0) return
    sending = true
    const batch = queue.splice(0, 500)
    try {
      const res = await fetch(ingest, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records: batch }),
      })
      const data = await res.json().catch(() => null)
      const ok = res.ok
      console.log(
        `[realtime-capture] ${ok ? 'ingest' : 'INGEST-FAIL'} ${batch.length} records -> ` +
          (data !== null ? JSON.stringify(data) : `HTTP ${res.status}`),
      )
      if (!ok && batch.length > 1) {
        // retry one-by-one so a single bad record never blocks the stream
        for (const rec of batch) {
          const r2 = await fetch(ingest, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ records: [rec] }),
          })
          if (!r2.ok) console.error('[realtime-capture] single-record ingest failed:', rec.method, rec.url)
        }
      }
    } catch (error) {
      console.error('[realtime-capture] ingest error:', error instanceof Error ? error.message : String(error))
      queue.unshift(...batch)
    } finally {
      sending = false
    }
  }
  const timer = setInterval(() => void flush(), flushMs)

  console.log(`[realtime-capture] tailing ${logPath} (replay=${replay}, ingest=${ingest})`)
  engine.start()
  const statusTimer = setInterval(() => {
    const s = engine.status()
    console.log(
      `[realtime-capture] status: running=${s.running} offset=${s.offset}/${s.logSize} ` +
        `seen=${s.counters.requestsSeen} emitted=${s.counters.emitted} bodies=${s.counters.bodies} dropped=${s.counters.droppedNoStatus}`,
    )
  }, 15000)

  const shutdown = () => {
    engine.stop()
    clearInterval(timer)
    clearInterval(statusTimer)
    void flush().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** Compare realpaths so junction/symlinked install dirs still count as "main". */
function isMainModule() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  runStandalone().catch((error) => {
    console.error('[realtime-capture] fatal:', error)
    process.exit(1)
  })
}
