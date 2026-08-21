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
import { execFile } from 'node:child_process'

const require = createRequire(import.meta.url)
const forge = require('node-forge')

/** Per-field body cap for stored records (2MB). */
const BODY_CAP = 2 * 1024 * 1024
/** Stop buffering a body beyond this (still streams to the client). */
const BUFFER_CAP = 50 * 1024 * 1024

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

/** Parse an upstream proxy spec like http://127.0.0.1:6518 or host:port. */
function parseUpstream(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return null
  let s = spec.trim()
  if (!s.includes('://')) s = 'http://' + s
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const host = u.hostname || '127.0.0.1'
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  return { host, port }
}

/** Open (and optionally TLS-wrap) a connection to host:port, chaining through the upstream proxy when set. */
function tunnelConnect({ upstream, host, port, secure }, cb) {
  let done = false
  const fail = (error) => {
    if (done) return
    done = true
    cb(error)
  }
  const wrapTls = (socket) => {
    if (!secure) {
      done = true
      cb(null, socket)
      return
    }
    const t = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: false, // capture-first tooling; see README
    })
    t.once('secureConnect', () => {
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
    s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Connection: keep-alive\r\n\r\n`)
    let buf = ''
    const onData = (d) => {
      buf += d.toString('latin1')
      const idx = buf.indexOf('\r\n\r\n')
      if (idx < 0) return
      s.removeListener('data', onData)
      const statusLine = buf.slice(0, idx)
      const status = Number.parseInt(statusLine.split(' ')[1], 10)
      if (status === 200) {
        wrapTls(s)
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
    tunnelConnect({ upstream: this.upstream, host: options.host, port: options.port, secure: false }, cb)
  }
}

/** HTTPS agent: upstream-chained CONNECT + TLS inside createConnection (protocol must be https:). */
class SecureForwardAgent extends https.Agent {
  constructor({ upstream }) {
    super({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32 })
    this.upstream = upstream
  }

  createConnection(options, cb) {
    tunnelConnect({ upstream: this.upstream, host: options.host, port: options.port, secure: true }, cb)
  }
}

export class ProxyEngine {
  constructor({ certDir, port = 8899, upstream = undefined, onRecord = () => {} } = {}) {
    this.certDir = certDir
    this.port = port
    this.upstream = upstream // {host,port} | null(=direct) | undefined(=auto: read system proxy)
    this.onRecord = onRecord
    this.server = null
    this.counters = { requests: 0, mitm: 0, errors: 0 }
    this.ca = null
    this.hostCerts = new Map()
    this.agents = null
    this.backupSystemProxy = null
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

  /** Forward one request through the (optional upstream-chained) agent. */
  forward({ secure, host, port, pathname, method, headers, body }) {
    const mod = secure ? https : http
    return new Promise((resolve, reject) => {
      const clean = stripHopByHop(headers)
      clean.host = host
      const req = mod.request({
        host,
        port,
        path: pathname,
        method,
        headers: clean,
        agent: secure ? this.secureAgents : this.agents,
      }, (res) => {
        resolve({ res, status: res.statusCode, headers: res.headers })
      })
      req.once('error', reject)
      if (body !== undefined && body.length > 0) req.write(body)
      req.end()
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
    const record = { ts: started, source: 'proxy', process: 'local-proxy', method: req.method, url: req.url }
    this.counters.requests++
    try {
      const reqChunks = []
      req.on('data', (c) => {
        if (reqChunks.length < BUFFER_CAP) reqChunks.push(c)
      })
      await new Promise((r) => req.on('end', r))
      const reqBuf = Buffer.concat(reqChunks)
      const reqText = bodyForStore(reqBuf, req.headers['content-encoding'], req.headers['content-type'])
      if (reqText !== '') record.reqBody = reqText
      if (Object.keys(stripHopByHop(req.headers)).length > 0) record.reqHeaders = stripHopByHop(req.headers)

      const fwd = await this.forward({
        secure: u.protocol === 'https:',
        host,
        port,
        pathname: u.pathname + u.search,
        method: req.method,
        headers: req.headers,
        body: reqBuf,
      })
      const fh = stripHopByHop(fwd.headers)
      res.writeHead(fwd.status, fh)
      const resChunks = []
      fwd.res.on('data', (c) => {
        res.write(c)
        if (resChunks.length < BUFFER_CAP) resChunks.push(c)
      })
      await new Promise((r) => fwd.res.on('end', r))
      res.end()
      record.status = fwd.status
      record.resHeaders = fh
      record.durationMs = Date.now() - started
      const resText = bodyForStore(Buffer.concat(resChunks), fwd.headers['content-encoding'], fwd.headers['content-type'])
      if (resText !== '') record.resBody = resText
      record.note = '本地代理捕获'
      this.onRecord(record)
    } catch (error) {
      this.counters.errors++
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
      req.on('data', (c) => {
        if (reqChunks.length < BUFFER_CAP) reqChunks.push(c)
      })
      await new Promise((r) => req.on('end', r))
      const reqBuf = Buffer.concat(reqChunks)
      const reqText = bodyForStore(reqBuf, req.headers['content-encoding'], req.headers['content-type'])
      if (reqText !== '') record.reqBody = reqText
      if (Object.keys(stripHopByHop(req.headers)).length > 0) record.reqHeaders = stripHopByHop(req.headers)

      const fwd = await this.forward({
        secure: true,
        host,
        port: port === 443 ? 443 : port,
        pathname: req.url,
        method: req.method,
        headers: req.headers,
        body: reqBuf,
      })
      const fh = stripHopByHop(fwd.headers)
      res.writeHead(fwd.status, fh)
      const resChunks = []
      fwd.res.on('data', (c) => {
        res.write(c)
        if (resChunks.length < BUFFER_CAP) resChunks.push(c)
      })
      await new Promise((r) => fwd.res.on('end', r))
      res.end()
      record.status = fwd.status
      record.resHeaders = fh
      record.durationMs = Date.now() - started
      const resText = bodyForStore(Buffer.concat(resChunks), fwd.headers['content-encoding'], fwd.headers['content-type'])
      if (resText !== '') record.resBody = resText
      record.note = '本地代理捕获(HTTPS 解密)'
      this.onRecord(record)
    } catch (error) {
      this.counters.errors++
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
      mini.on('clientError', () => {})
      mini.emit('connection', tlsSocket)
      if (head !== undefined && head.length > 0) tlsSocket.unshift(head)
    } catch (error) {
      this.counters.errors++
      clientSocket.destroy()
    }
  }

  start({ port = this.port, upstream = this.upstream } = {}) {
    if (this.server !== null) return this.status()
    this.port = port
    if (upstream === undefined || upstream === 'auto') {
      const sys = readSystemProxy()
      this.upstream = sys.enable && sys.server !== '' ? parseUpstream(sys.server) : null
    } else {
      this.upstream = upstream === null || upstream === '' ? null : parseUpstream(upstream)
    }
    this.ensureCa()
    this.agents = new ForwardAgent({ upstream: this.upstream })
    this.secureAgents = new SecureForwardAgent({ upstream: this.upstream })
    this.server = http.createServer((req, res) => {
      this.handlePlain(req, res).catch(() => {})
    })
    this.server.on('connect', (req, socket, head) => this.handleConnect(req, socket, head))
    this.server.on('clientError', (error, socket) => {
      this.counters.errors++
      socket.destroy()
    })
    this.server.listen(port, '127.0.0.1')
    this.startedAt = Date.now()
    return this.status()
  }

  stop() {
    if (this.server !== null) {
      this.server.close()
      this.server = null
    }
    if (this.agents !== null) {
      this.agents.destroy()
      this.agents = null
    }
    if (this.secureAgents !== null) {
      this.secureAgents.destroy()
      this.secureAgents = null
    }
    return this.status()
  }

  status() {
    return {
      running: this.server !== null,
      port: this.port,
      upstream: this.upstream === null ? null : `${this.upstream.host}:${this.upstream.port}`,
      caPath: path.join(this.certDir, 'ca-cert.pem'),
      caReady: this.ca !== null || fs.existsSync(path.join(this.certDir, 'ca-cert.pem')),
      systemProxyActive: this.systemProxyEnabled(),
      counters: { ...this.counters },
      startedAt: this.startedAt ?? null,
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
