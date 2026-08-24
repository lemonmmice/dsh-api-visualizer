/**
 * dsh-api-visualizer — client half (browser bundle, hand-built for the
 * __ModuleLoader__ format; no build step).
 *
 * Mounts the 「接口捕获」 sidebar entry and a live panel in the center
 * column: stats chips, filters (keyword / method / status / source), a
 * records table, and a JSON detail drawer. Data comes from the host's
 * /api/dsh-api-visualizer route family via plain same-origin fetch; the
 * panel polls every 2.5s while open. Plain DOM everywhere (no React), so
 * the bundle only depends on the module loader's built-in globals.
 */
window.__ModuleLoader__.load({
  id: '@linxin666/dsh-api-visualizer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const API = '/api/dsh-api-visualizer'
    const ENTRY_SEL = '[data-dsh-apiviz-entry]'
    const VIEW_SEL = '[data-dsh-apiviz-view]'
    const POLL_MS = 2500
    const POLL_LIVE_MS = 1000
    const LIMIT = 300
    let liveDot = null

    const CSS = `
[data-dsh-apiviz-view]{position:absolute;inset:0;z-index:60;display:none;flex-direction:column;
background:var(--dsw-alias-bg-base,#171a21);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
html[data-dsh-apiviz-active] [data-dsh-apiviz-view]{display:flex}
.apv-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.apv-title{font-weight:600;font-size:14px;margin-right:4px}
.apv-stats{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.apv-q{flex:1 1 180px;min-width:120px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 8px;font:inherit}
.apv-select{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 6px;font:inherit}
.apv-btn{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.apv-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.apv-btn-danger:hover{border-color:#c0392b;color:#e74c3c}
.apv-close{margin-left:auto;font-size:16px;line-height:1;padding:4px 8px}
.apv-body{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
.apv-table-wrap{flex:1;overflow:auto}
.apv-table{width:100%;border-collapse:collapse;white-space:nowrap}
.apv-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);text-align:left;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l2);z-index:1}
.apv-table td{padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top;max-width:520px;overflow:hidden;text-overflow:ellipsis}
.apv-table tbody tr{cursor:pointer}
.apv-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.apv-table tbody tr.apv-selected{background:var(--dsw-static-deepseek-100)}
.apv-table tbody tr.apv-selected:hover{background:var(--dsw-static-deepseek-100)}
body[data-ds-dark-theme] .apv-table tbody tr.apv-selected{background:#1e2a44}
body[data-ds-dark-theme] .apv-table tbody tr.apv-selected:hover{background:#1e2a44}
.apv-table tbody tr.apv-selected td:first-child{box-shadow:inset 2px 0 0 #60a5fa}
.apv-empty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:40px 0}
.apv-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600}
.apv-m-get{background:var(--dsw-static-green-100);color:var(--dsw-static-green-900)}.apv-m-post{background:var(--dsw-static-blue-100);color:var(--dsw-static-blue-900)}.apv-m-put{background:var(--dsw-static-amber-100);color:var(--dsw-static-amber-900)}
body[data-ds-dark-theme] .apv-m-get{background:#1b4d3a;color:#4ade80}body[data-ds-dark-theme] .apv-m-post{background:#1e3a5f;color:#60a5fa}body[data-ds-dark-theme] .apv-m-put{background:#4a3b14;color:#fbbf24}
.apv-m-delete{background:var(--dsw-static-red-100);color:var(--dsw-static-red-900)}.apv-m-other{background:var(--dsw-static-neutral-bluish-100);color:var(--dsw-static-neutral-bluish-700)}
body[data-ds-dark-theme] .apv-m-delete{background:#4c1d1d;color:#f87171}body[data-ds-dark-theme] .apv-m-other{background:#33363f;color:#cbd5e1}
.apv-s-2{background:var(--dsw-static-green-100);color:var(--dsw-static-green-900)}.apv-s-3{background:var(--dsw-static-blue-100);color:var(--dsw-static-blue-900)}.apv-s-4{background:var(--dsw-static-amber-100);color:var(--dsw-static-amber-900)}
body[data-ds-dark-theme] .apv-s-2{background:#1b4d3a;color:#4ade80}body[data-ds-dark-theme] .apv-s-3{background:#1e3a5f;color:#60a5fa}body[data-ds-dark-theme] .apv-s-4{background:#4a3b14;color:#fbbf24}
.apv-s-5{background:var(--dsw-static-red-100);color:var(--dsw-static-red-900)}.apv-s-0{background:var(--dsw-static-neutral-bluish-100);color:var(--dsw-static-neutral-bluish-700)}
body[data-ds-dark-theme] .apv-s-5{background:#4c1d1d;color:#f87171}body[data-ds-dark-theme] .apv-s-0{background:#33363f;color:#cbd5e1}
.apv-note{color:var(--dsw-alias-label-tertiary);font-size:12px}
.apv-detail{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2);max-height:45%;min-height:120px}
.apv-detail[hidden]{display:none}
.apv-detail-head{display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--dsw-alias-bg-layer-2)}
.apv-detail-head .apv-durl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}
.apv-detail pre{flex:1;overflow:auto;margin:0;padding:10px 12px;font:12px/1.5 Consolas,Menlo,monospace;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all}
.apv-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:none;border:none;color:inherit;cursor:pointer;font:inherit;text-align:left}
.apv-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.apv-entry[data-active]{background:var(--dsw-alias-interactive-bg-hover)}
.apv-entry .apv-entry-label{font-size:13px}
.apv-entry svg{flex:none}
.apv-live-dot{width:8px;height:8px;border-radius:50%;background:#3a3f4a;flex:none;margin-left:auto}
.apv-live-dot[data-on="1"]{background:#2ecc71;box-shadow:0 0 6px #2ecc71;animation:apv-pulse 1.6s infinite}
@keyframes apv-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.apv-live-on{color:#2ecc71}
.apv-capture-on{border-color:#2ecc71;color:#2ecc71}
.apv-autoscroll{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;cursor:pointer}
.apv-sep{color:var(--dsw-alias-border-l2)}
.apv-port{width:64px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 6px;font:inherit}
.apv-btn-danger:hover{border-color:#c0392b;color:#e74c3c}
.apv-btn-on{border-color:#2ecc71;color:#2ecc71}
.apv-star{background:none;border:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;padding:0 4px;line-height:1}
.apv-star[data-on="1"]{color:#fbbf24}
.apv-detail-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.apv-detail-bar .apv-in{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 8px;font:inherit}
.apv-detail-bar .apv-in-note{flex:1 1 160px;min-width:120px}
.apv-detail-bar .apv-in-tag{width:110px}
.apv-detail-body{flex:1;overflow:auto;padding:0 12px 12px}
.apv-sec{margin-top:10px}
.apv-sec-title{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.apv-sec-title .apv-t{font-weight:600}
.apv-sec-pre{margin:0;padding:8px 10px;font:12px/1.5 Consolas,Menlo,monospace;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:normal;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-2);border-radius:6px;max-height:340px;overflow:auto}
.apv-sec-body{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:8px 10px;max-height:340px;overflow:auto}
.apv-viewbtns{display:flex;gap:4px;margin-left:auto}
.apv-viewbtns .apv-btn{padding:2px 8px;font-size:11px}
[data-apv-back-entry]{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;white-space:nowrap}
[data-apv-back-entry]:hover{color:var(--dsw-static-deepseek-500);border-color:var(--dsw-static-deepseek-500)}
.apv-jt{font:12px/1.6 Consolas,Menlo,monospace}
.apv-jt-row{white-space:pre}
.apv-jt-toggle{cursor:pointer;user-select:none}
.apv-jt-toggle:hover{color:var(--dsw-static-deepseek-500)}
.apv-jt-collapsed::after{content:' …';color:var(--dsw-alias-label-tertiary)}
.apv-jt-brace{color:var(--dsw-alias-label-tertiary)}
.apv-jt-key{color:var(--dsw-static-deepseek-500)}
.apv-jt-idx{color:var(--dsw-alias-label-tertiary)}
.apv-jt-str{color:var(--dsw-static-green-900)}
body[data-ds-dark-theme] .apv-jt-str{color:#9fe8a0}
.apv-jt-num{color:var(--dsw-static-amber-900)}
body[data-ds-dark-theme] .apv-jt-num{color:#fbbf24}
.apv-jt-bool,.apv-jt-null{color:var(--dsw-static-neutral-bluish-700)}
body[data-ds-dark-theme] .apv-jt-bool,.apv-jt-null{color:#c4a7f0}
.apv-jt-kids{border-left:1px solid var(--dsw-alias-border-l2);margin-left:8px;padding-left:8px}
.apv-mark{background:var(--dsw-static-amber-100);color:var(--dsw-static-amber-900);border-radius:2px;padding:0 1px}
body[data-ds-dark-theme] .apv-mark{background:#7c5c00;color:#fff}
.apv-img{max-width:100%;max-height:320px;border-radius:6px;display:block}
.apv-iframe{width:100%;height:320px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:#fff}
.apv-filterbar{display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.apv-filterbar[hidden]{display:none}
.apv-frow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.apv-fin{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 8px;font:inherit}
.apv-fin-host{width:150px}.apv-fin-ct{width:150px}.apv-fin-dur{width:90px}.apv-fin-body{flex:1 1 160px;min-width:120px}
.apv-fcb{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;cursor:pointer}
.apv-agg{padding:8px 12px;overflow:auto}
.apv-agg[hidden]{display:none}
`

    // ---------------------------------------------------------------- helpers

    function injectStyle() {
      if (typeof document === 'undefined' || document.getElementById('dsh-apiviz-style') !== null) return
      const style = document.createElement('style')
      style.id = 'dsh-apiviz-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function apiFetch(path, init) {
      const response = await fetch(API + path, init)
      let body
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) throw new Error((body && body.error) || `HTTP ${response.status}`)
      return body
    }

    function el(tag, className, text) {
      const node = document.createElement(tag)
      if (className !== undefined && className !== '') node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    function fmtTime(ts) {
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
    }

    function fmtDur(ms) {
      if (typeof ms !== 'number') return '-'
      return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
    }

    function methodBadge(method) {
      const cls = { GET: 'apv-m-get', POST: 'apv-m-post', PUT: 'apv-m-put', DELETE: 'apv-m-delete' }[method] || 'apv-m-other'
      return el('span', 'apv-badge ' + cls, method)
    }

    function statusBadge(status) {
      if (!Number.isInteger(status)) return el('span', 'apv-badge apv-s-0', '-')
      return el('span', 'apv-badge apv-s-' + Math.floor(status / 100), String(status))
    }

    /** Lenient indentation for a JSON fragment (works on truncated/incomplete JSON text). */
    function prettyJsonFragment(s, cap) {
      let out = ''
      let indent = 0
      let inString = false
      let esc = false
      const max = cap ?? 262144
      for (let i = 0; i < s.length; i++) {
        if (out.length >= max) {
          out += '\n…(片段过长，已省略)'
          break
        }
        const c = s[i]
        if (inString) {
          out += c
          if (esc) { esc = false; continue }
          if (c === '\\') { esc = true; continue }
          if (c === '"') inString = false
          continue
        }
        if (c === '"') { inString = true; out += c; continue }
        switch (c) {
          case '{':
          case '[':
            out += c + '\n' + '  '.repeat(++indent)
            break
          case '}':
          case ']':
            indent = Math.max(0, indent - 1)
            out += '\n' + '  '.repeat(indent) + c
            break
          case ',':
            out += c + '\n' + '  '.repeat(indent)
            break
          case ':':
            out += c + ' '
            break
          default:
            out += c
        }
      }
      return out
    }

    /** Render one body: pretty JSON when parseable, readable fragment when truncated, raw text otherwise. */
    function formatBody(v) {
      if (typeof v !== 'string' || v === '') return null
      let text = v
      const truncated = text.endsWith('…(截断)')
      if (truncated) text = text.slice(0, -5)
      try {
        const pretty = JSON.stringify(JSON.parse(text), null, 2)
        return (truncated ? '(响应体超过 2MB 上限，已截断)\n' : '') + pretty
      } catch {
        // Not strictly parseable — truncated at the 2MB cap, trailing bytes, or a
        // reassembled capture fragment. If it still looks like JSON, indent it
        // leniently so it reads as a tree instead of one crammed blob.
        if (/^\s*[{\[]/.test(text)) {
          const note = truncated ? '(响应体超过 2MB 上限，以下为可读片段)\n' : ''
          return note + prettyJsonFragment(text)
        }
        return v
      }
    }

    /** Sectioned detail dump: bodies render raw (pretty), never as escaped blob strings. */
    function detailText(full) {
      const meta = {
        method: full.method,
        url: full.url,
        status: full.status,
        time: Number.isFinite(full.ts) ? new Date(full.ts).toLocaleString() : undefined,
        source: full.source,
        durationMs: full.durationMs,
        process: full.process,
        note: full.note,
      }
      const parts = ['=== 基本信息 ===', JSON.stringify(meta, null, 2)]
      if (full.reqHeaders !== undefined) parts.push('=== 请求头 ===', JSON.stringify(full.reqHeaders, null, 2))
      const rb = formatBody(full.reqBody)
      if (rb !== null) parts.push('=== 请求体 ===', rb)
      if (full.resHeaders !== undefined) parts.push('=== 响应头 ===', JSON.stringify(full.resHeaders, null, 2))
      const sb = formatBody(full.resBody)
      if (sb !== null) parts.push('=== 响应体 ===', sb)
      return parts.join('\n\n')
    }

    /** Copy text to the clipboard with a legacy fallback; flips the button label briefly. */
    function copyText(text, btn, originalLabel) {
      const label = originalLabel !== undefined ? originalLabel : btn.textContent
      const done = () => {
        btn.textContent = '已复制 ✓'
        setTimeout(() => { btn.textContent = label }, 1500)
      }
      const legacy = () => {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        let ok = false
        try { ok = document.execCommand('copy') } catch { ok = false }
        document.body.removeChild(ta)
        if (ok) done()
      }
      if (navigator.clipboard !== undefined && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, legacy)
      } else {
        legacy()
      }
    }

    // ------------------------------------------------------- P0-1 copy-as snippets

    function snippetCurl(rec) {
      const parts = [`curl -X ${rec.method} '${rec.url.replace(/'/g, "'\\''")}'`]
      for (const [k, v] of Object.entries(rec.reqHeaders ?? {})) {
        parts.push(`-H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
      }
      if (typeof rec.reqBody === 'string' && rec.reqBody !== '' && !/^(GET|HEAD)$/i.test(rec.method)) {
        parts.push(`--data-raw '${rec.reqBody.replace(/'/g, "'\\''")}'`)
      }
      return parts.join(' \\\n  ')
    }

    function snippetPwsh(rec) {
      const headers = {}
      for (const [k, v] of Object.entries(rec.reqHeaders ?? {})) {
        headers[k] = String(v)
      }
      const lines = []
      lines.push(`$headers = @{`)
      for (const [k, v] of Object.entries(headers)) lines.push(`  '${k.replace(/'/g, "''")}' = '${String(v).replace(/'/g, "''")}'`)
      lines.push(`}`)
      lines.push(`Invoke-RestMethod -Method ${rec.method} -Uri '${rec.url.replace(/'/g, "''")}' -Headers $headers` + (typeof rec.reqBody === 'string' && rec.reqBody !== '' && !/^(GET|HEAD)$/i.test(rec.method) ? ` -Body '${rec.reqBody.replace(/'/g, "''")}'` : ''))
      return lines.join('\n')
    }

    function snippetFetch(rec) {
      const headers = {}
      for (const [k, v] of Object.entries(rec.reqHeaders ?? {})) {
        headers[k] = String(v)
      }
      const opts = [`method: '${rec.method}'`]
      if (Object.keys(headers).length > 0) opts.push(`headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`)
      if (typeof rec.reqBody === 'string' && rec.reqBody !== '' && !/^(GET|HEAD)$/i.test(rec.method)) opts.push(`body: ${JSON.stringify(rec.reqBody)}`)
      return `fetch('${rec.url.replace(/'/g, "\\'")}', {\n  ${opts.join(',\n  ')}\n})`
    }

    function buildSnippet(kind, rec) {
      if (kind === 'curl') return snippetCurl(rec)
      if (kind === 'pwsh') return snippetPwsh(rec)
      return snippetFetch(rec)
    }

    // ------------------------------------------------------- P0-4 redaction/export

    const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-token|access-token|token)$/i
    const SENSITIVE_QUERY = /^(token|usertoken|connectiontoken|access_token|refresh_token|password|secret|apikey|api_key|sign|sig)$/i

    function redactUrl(url) {
      try {
        const u = new URL(url)
        for (const key of [...u.searchParams.keys()]) {
          if (SENSITIVE_QUERY.test(key)) u.searchParams.set(key, '***')
        }
        return u.toString()
      } catch {
        return url.replace(/([?&](?:token|usertoken|userToken|connectionToken|access_token|password|secret|apikey|sign|sig)=)[^&]*/gi, '$1***')
      }
    }

    function redactRecord(rec) {
      const out = { ...rec }
      if (typeof out.url === 'string') out.url = redactUrl(out.url)
      for (const key of ['reqHeaders', 'resHeaders']) {
        if (out[key] === null || typeof out[key] !== 'object') continue
        const headers = {}
        for (const [k, v] of Object.entries(out[key])) {
          headers[k] = SENSITIVE_HEADERS.test(k) ? '***' : v
        }
        out[key] = headers
      }
      return out
    }

    function downloadBlob(filename, content, type) {
      const blob = new Blob([content], { type: type ?? 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    function buildHar(records) {
      return {
        log: {
          version: '1.2',
          creator: { name: 'dsh-api-visualizer', version: '0.2.0' },
          entries: records.map((r) => ({
            startedDateTime: Number.isFinite(r.ts) ? new Date(r.ts).toISOString() : new Date().toISOString(),
            time: r.durationMs ?? 0,
            request: {
              method: r.method,
              url: r.url,
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(r.reqHeaders ?? {}).map(([name, value]) => ({ name, value: String(value) })),
              queryString: [],
              postData: typeof r.reqBody === 'string' && r.reqBody !== '' ? { mimeType: 'text/plain', text: r.reqBody } : undefined,
            },
            response: {
              status: r.status ?? 0,
              statusText: '',
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(r.resHeaders ?? {}).map(([name, value]) => ({ name, value: String(value) })),
              content: typeof r.resBody === 'string' ? { size: r.resBody.length, mimeType: (r.resHeaders ?? {})['content-type'] ?? 'text/plain', text: r.resBody } : { size: 0, mimeType: 'text/plain' },
            },
            cache: {},
            timings: { send: 0, wait: r.durationMs ?? 0, receive: 0 },
            comment: r.note ?? '',
          })),
        },
      }
    }

    // ------------------------------------------------------- P0-3 json tree

    /** Collapsible JSON tree (plain DOM). Objects/arrays expand/collapse on click. */
    function jsonTreeEl(value, depth) {
      const d = depth ?? 0
      if (value !== null && typeof value === 'object') {
        const isArr = Array.isArray(value)
        const wrap = el('div', 'apv-jt')
        const row = el('div', 'apv-jt-row apv-jt-toggle')
        const kids = Object.keys(value)
        const expanded = d < 2
        row.appendChild(el('span', 'apv-jt-brace', isArr ? `[${kids.length}]` : `{${kids.length}}`))
        row.addEventListener('click', () => {
          container.hidden = !container.hidden
          row.classList.toggle('apv-jt-collapsed', container.hidden)
        })
        wrap.appendChild(row)
        const container = el('div', 'apv-jt-kids')
        if (!expanded) {
          container.hidden = true
          row.classList.add('apv-jt-collapsed')
        }
        for (const key of kids) {
          const childRow = el('div', 'apv-jt-row')
          if (isArr) childRow.appendChild(el('span', 'apv-jt-idx', key + ': '))
          else childRow.appendChild(el('span', 'apv-jt-key', JSON.stringify(key) + ': '))
          childRow.appendChild(jsonTreeEl(value[key], d + 1))
          container.appendChild(childRow)
        }
        wrap.appendChild(container)
        return wrap
      }
      const span = el('span', value === null ? 'apv-jt-null' : typeof value === 'number' ? 'apv-jt-num' : value === true || value === false ? 'apv-jt-bool' : 'apv-jt-str')
      span.textContent = value === null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : String(value)
      return span
    }

    /** Highlight matches of a query inside a pre (returns element; skips when query empty). */
    function highlightedPre(text, query) {
      const pre = el('pre', 'apv-sec-pre')
      const q = (query ?? '').trim()
      if (q === '') {
        pre.textContent = text
        return pre
      }
      let escaped
      try {
        escaped = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      } catch {
        escaped = null
      }
      if (escaped === null) {
        pre.textContent = text
        return pre
      }
      const parts = text.split(escaped)
      let idx = 0
      escaped.lastIndex = 0
      let m
      while ((m = escaped.exec(text)) !== null) {
        pre.appendChild(document.createTextNode(text.slice(idx, m.index)))
        const mark = el('mark', 'apv-mark', m[0])
        pre.appendChild(mark)
        idx = m.index + m[0].length
        if (m.index === escaped.lastIndex) escaped.lastIndex += 1
      }
      pre.appendChild(document.createTextNode(text.slice(idx)))
      return pre
    }

    // ------------------------------------------------------------ sidebar entry

    function sidebarRoot() {
      const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
      if (column === null) return undefined
      const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement
      return logoOwner ?? (column.firstElementChild)
    }

    function newSessionButton(root) {
      const nested = root.querySelector('button[class*="newSession"]')
      if (nested !== null) return nested
      for (const child of root.children) {
        if (child.tagName === 'BUTTON') return child
      }
      return undefined
    }

    const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h2.5l1.8-4 2.4 8 1.8-4H14"/></svg>`

    function createEntry(toggle) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.dataset.dshApivizEntry = ''
      entry.className = 'apv-entry'
      entry.setAttribute('aria-label', '接口捕获')
      entry.innerHTML = `<span>${ICON}</span><span class="apv-entry-label">接口捕获</span>`
      liveDot = el('span', 'apv-live-dot')
      liveDot.title = '实时捕获状态'
      entry.appendChild(liveDot)
      entry.addEventListener('click', toggle)
      return entry
    }

    function placeEntry(root, entry) {
      const button = newSessionButton(root)
      if (button === undefined) return false
      if (entry.parentElement !== root) {
        const row = button.closest('[class*="logoRow"]')
        const base = (row !== null && row.parentElement === root) ? row : button
        const family = Array.from(root.children).filter(
          (child) => child instanceof HTMLElement && child.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-apiviz-entry]'),
        )
        const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
        root.insertBefore(entry, anchor)
      }
      return true
    }

    function mountSidebarEntry(toggle) {
      if (typeof document !== 'undefined' && document.querySelector(ENTRY_SEL) !== null) return () => {}
      const entry = createEntry(toggle)
      let root
      let placed = false
      const tryPlace = () => {
        if (root !== undefined && !root.isConnected) {
          rootObserver.disconnect()
          root = undefined
          placed = false
        }
        if (placed) {
          if (document.body.contains(entry)) return
          rootObserver.disconnect()
          root = undefined
          placed = false
        }
        root ??= sidebarRoot()
        if (root === undefined) return
        placed = placeEntry(root, entry)
        if (placed) rootObserver.observe(root, { childList: true, subtree: true })
      }
      const waitObserver = new MutationObserver(() => { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })
      const rootObserver = new MutationObserver(() => {
        if (root === undefined || !root.isConnected) {
          placed = false
          tryPlace()
          return
        }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })
      tryPlace()
      return () => {
        waitObserver.disconnect()
        rootObserver.disconnect()
        entry.remove()
      }
    }

    // ------------------------------------------------------------------ panel

    function centerColumn() {
      return document.querySelector('[data-pane="conversation"], [class*="centerCol"]') ?? document.body
    }

    /** The view is a fixed overlay inside the center column (like task-board). */
    function buildPanel() {
      const view = el('div')
      view.dataset.dshApivizView = ''

      // toolbar
      const toolbar = el('div', 'apv-toolbar')
      toolbar.appendChild(el('span', 'apv-title', '接口捕获'))
      const stats = el('span', 'apv-stats', '…')
      toolbar.appendChild(stats)
      const q = el('input', 'apv-q')
      q.placeholder = '搜索 URL / 备注'
      toolbar.appendChild(q)
      const methodSel = el('select', 'apv-select')
      ;['', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].forEach((m) => {
        const opt = el('option', '', m === '' ? '方法:全部' : m)
        opt.value = m
        methodSel.appendChild(opt)
      })
      toolbar.appendChild(methodSel)
      const statusSel = el('select', 'apv-select')
      ;['', '2xx', '3xx', '4xx', '5xx'].forEach((s) => {
        const opt = el('option', '', s === '' ? '状态:全部' : s)
        opt.value = s
        statusSel.appendChild(opt)
      })
      toolbar.appendChild(statusSel)
      const sourceSel = el('select', 'apv-select')
      toolbar.appendChild(sourceSel)
      const flaggedBtn = el('button', 'apv-btn', '只看标记')
      flaggedBtn.title = '只显示打了星标的记录'
      toolbar.appendChild(flaggedBtn)
      const captureBtn = el('button', 'apv-btn', '开始实时捕获')
      captureBtn.id = 'apv-capture-toggle'
      captureBtn.title = '像 Fiddler 一样实时抓取客户端 HTTP 流量（自动解析入库）'
      toolbar.appendChild(captureBtn)
      const captureChip = el('span', 'apv-stats', '')
      toolbar.appendChild(captureChip)
      const autoScrollWrap = el('label', 'apv-autoscroll')
      const autoScrollCb = el('input', '')
      autoScrollCb.type = 'checkbox'
      autoScrollCb.checked = true
      autoScrollWrap.appendChild(autoScrollCb)
      autoScrollWrap.appendChild(document.createTextNode(' 自动滚动'))
      toolbar.appendChild(autoScrollWrap)
      // 本地代理（Fiddler 式，抓任意进程）
      const proxySep = el('span', 'apv-sep', '|')
      toolbar.appendChild(proxySep)
      const portInput = el('input', 'apv-port')
      portInput.type = 'number'
      portInput.min = '1'
      portInput.max = '65535'
      portInput.value = '8899'
      portInput.title = '代理监听端口'
      toolbar.appendChild(portInput)
      const proxyBtn = el('button', 'apv-btn', '启动代理')
      proxyBtn.title = '启动本地 HTTP(S) 代理：任意程序把代理指向它即可被抓包（HTTPS 自动解密）'
      toolbar.appendChild(proxyBtn)
      const proxyChip = el('span', 'apv-stats', '')
      toolbar.appendChild(proxyChip)
      const caBtn = el('button', 'apv-btn', '安装根证书')
      caBtn.title = '把本插件生成的根证书导入本机信任（当前用户，无需管理员）'
      toolbar.appendChild(caBtn)
      const sysProxyBtn = el('button', 'apv-btn', '设为系统代理')
      sysProxyBtn.title = '把 Windows 系统代理指向本代理（浏览器等程序即走它）；再次点击恢复原设置'
      toolbar.appendChild(sysProxyBtn)
      // 导出（P0-4）
      const exportSep = el('span', 'apv-sep', '|')
      toolbar.appendChild(exportSep)
      const exportSel = el('select', 'apv-select')
      ;['HAR', 'JSON', 'CSV'].forEach((f) => {
        const opt = el('option', '', f)
        opt.value = f
        exportSel.appendChild(opt)
      })
      toolbar.appendChild(exportSel)
      const exportRedactWrap = el('label', 'apv-autoscroll')
      const exportRedactCb = el('input', '')
      exportRedactCb.type = 'checkbox'
      exportRedactCb.checked = false
      exportRedactWrap.appendChild(exportRedactCb)
      exportRedactWrap.appendChild(document.createTextNode(' 脱敏'))
      toolbar.appendChild(exportRedactWrap)
      const exportBtn = el('button', 'apv-btn', '导出')
      exportBtn.title = '导出 全部/当前筛选 的记录为 HAR / JSON / CSV（可勾选脱敏）'
      toolbar.appendChild(exportBtn)
      const refreshBtn = el('button', 'apv-btn', '刷新')
      toolbar.appendChild(refreshBtn)
      const clearBtn = el('button', 'apv-btn apv-btn-danger', '清空')
      toolbar.appendChild(clearBtn)
      const closeBtn = el('button', 'apv-btn apv-close', '×')
      closeBtn.title = '关闭'
      toolbar.appendChild(closeBtn)
      const moreBtn = el('button', 'apv-btn', '更多 ▾')
      moreBtn.title = '高级筛选 / 聚合视图 / 删除筛选集 / 自动捕获 / 日志路径'
      toolbar.appendChild(moreBtn)
      view.appendChild(toolbar)

      // ---- P1 advanced filter bar + observability controls
      const filterBar = el('div', 'apv-filterbar')
      filterBar.hidden = true
      const fRow1 = el('div', 'apv-frow')
      const hostIn = el('input', 'apv-fin apv-fin-host')
      hostIn.placeholder = '域名(逗号分隔)'
      hostIn.spellcheck = false
      fRow1.appendChild(hostIn)
      const ctIn = el('input', 'apv-fin apv-fin-ct')
      ctIn.placeholder = 'Content-Type 含'
      ctIn.spellcheck = false
      fRow1.appendChild(ctIn)
      const minDurIn = el('input', 'apv-fin apv-fin-dur')
      minDurIn.type = 'number'
      minDurIn.placeholder = '慢请求ms'
      fRow1.appendChild(minDurIn)
      const bodyQIn = el('input', 'apv-fin apv-fin-body')
      bodyQIn.placeholder = '在请求/响应体中查找…'
      bodyQIn.spellcheck = false
      fRow1.appendChild(bodyQIn)
      filterBar.appendChild(fRow1)
      const fRow2 = el('div', 'apv-frow')
      const mkCb = (label, cb) => {
        const wrap = el('label', 'apv-fcb')
        wrap.appendChild(cb)
        wrap.appendChild(document.createTextNode(' ' + label))
        fRow2.appendChild(wrap)
        return cb
      }
      const errorsCb = mkCb('只看错误', el('input', ''))
      errorsCb.type = 'checkbox'
      const noiseCb = mkCb('隐藏噪音', el('input', ''))
      noiseCb.type = 'checkbox'
      const regexCb = mkCb('正则', el('input', ''))
      regexCb.type = 'checkbox'
      const aggBtn = el('button', 'apv-btn', '聚合视图')
      aggBtn.title = '按 方法+路径 聚合：次数/错误率/平均/P95 耗时'
      fRow2.appendChild(aggBtn)
      const delFilteredBtn = el('button', 'apv-btn apv-btn-danger', '删除筛选集')
      delFilteredBtn.title = '删除当前筛选条件命中的全部记录'
      fRow2.appendChild(delFilteredBtn)
      const savedSel = el('select', 'apv-select')
      savedSel.title = '已保存的筛选'
      fRow2.appendChild(savedSel)
      const saveFilterBtn = el('button', 'apv-btn', '保存筛选')
      fRow2.appendChild(saveFilterBtn)
      const delSavedBtn = el('button', 'apv-btn', '删除')
      delSavedBtn.title = '删除选中的已保存筛选'
      fRow2.appendChild(delSavedBtn)
      filterBar.appendChild(fRow2)
      const fRow3 = el('div', 'apv-frow')
      const autoCapCb = mkCb('打开面板自动开始捕获', el('input', ''))
      autoCapCb.type = 'checkbox'
      const logPathIn = el('input', 'apv-fin apv-fin-body')
      logPathIn.placeholder = '跟踪日志路径（默认 %TEMP%\\uiprobe-net-trace.log）'
      logPathIn.spellcheck = false
      fRow3.appendChild(logPathIn)
      const healthHint = el('span', 'apv-note', '')
      fRow3.appendChild(healthHint)
      const clearLogsBtn = el('button', 'apv-btn apv-btn-danger', '清除日志')
      clearLogsBtn.title = '运行清理脚本：删除客户端跟踪日志（客户端运行时自动跳过）与抓包目录的日志文件'
      fRow3.appendChild(clearLogsBtn)
      filterBar.appendChild(fRow3)
      view.appendChild(filterBar)

      // table
      const body = el('div', 'apv-body')
      const tableWrap = el('div', 'apv-table-wrap')
      const table = el('table', 'apv-table')
      const thead = el('thead')
      const headRow = el('tr')
      headRow.appendChild(el('th', '', '★'))
      ;['时间', '方法', 'URL', '状态', '耗时', '来源', '备注'].forEach((h) => headRow.appendChild(el('th', '', h)))
      thead.appendChild(headRow)
      table.appendChild(thead)
      const tbody = el('tbody')
      table.appendChild(tbody)
      tableWrap.appendChild(table)
      body.appendChild(tableWrap)
      // ---- P1 aggregate view (observability)
      const aggWrap = el('div', 'apv-agg')
      aggWrap.hidden = true
      const aggTable = el('table', 'apv-table')
      const aggHead = el('thead')
      const aggHeadRow = el('tr')
      ;['端点', '次数', '错误率', '平均', 'P95', '最大', '最近状态', '样本 URL'].forEach((h) => aggHeadRow.appendChild(el('th', '', h)))
      aggHead.appendChild(aggHeadRow)
      aggTable.appendChild(aggHead)
      const aggBodyEl = el('tbody')
      aggTable.appendChild(aggBodyEl)
      aggWrap.appendChild(aggTable)
      body.appendChild(aggWrap)

      // detail drawer
      const detail = el('div', 'apv-detail')
      detail.hidden = true
      const detailHead = el('div', 'apv-detail-head')
      const detailTitle = el('span', 'apv-durl', '')
      const copyUrlBtn = el('button', 'apv-btn', '复制 URL')
      copyUrlBtn.title = '复制当前选中记录的 URL'
      const copyAsSel = el('select', 'apv-select')
      ;[['curl', 'cURL (bash)'], ['pwsh', 'Invoke-RestMethod'], ['fetch', 'fetch (JS)']].forEach(([v, label]) => {
        const opt = el('option', '', label)
        opt.value = v
        copyAsSel.appendChild(opt)
      })
      const copyAsBtn = el('button', 'apv-btn', '复制为')
      copyAsBtn.title = '按所选语言复制等价请求（cURL / PowerShell / fetch）'
      const replayBtn = el('button', 'apv-btn', '重放')
      replayBtn.title = '通过接口调试的服务端发送能力重新发送该请求，响应显示在下方对比'
      const openPmBtn = el('button', 'apv-btn', '在接口调试打开')
      openPmBtn.title = '把该请求预填进「接口调试」面板'
      const detailClose = el('button', 'apv-btn', '关闭')
      detailHead.appendChild(detailTitle)
      detailHead.appendChild(copyUrlBtn)
      detailHead.appendChild(copyAsSel)
      detailHead.appendChild(copyAsBtn)
      detailHead.appendChild(replayBtn)
      detailHead.appendChild(openPmBtn)
      detailHead.appendChild(detailClose)
      const detailBar = el('div', 'apv-detail-bar')
      const bodySearch = el('input', 'apv-in')
      bodySearch.placeholder = '在详情 body 中查找… (Enter)'
      bodySearch.spellcheck = false
      detailBar.appendChild(bodySearch)
      const noteInput = el('input', 'apv-in apv-in-note')
      noteInput.placeholder = '备注…'
      detailBar.appendChild(noteInput)
      const tagInput = el('input', 'apv-in apv-in-tag')
      tagInput.placeholder = '标签…'
      detailBar.appendChild(tagInput)
      const saveNoteBtn = el('button', 'apv-btn', '保存')
      saveNoteBtn.title = '保存备注/标签到该记录'
      detailBar.appendChild(saveNoteBtn)
      const delRecordBtn = el('button', 'apv-btn apv-btn-danger', '删除该条')
      delRecordBtn.title = '删除当前选中的这条记录'
      detailBar.appendChild(delRecordBtn)
      detail.appendChild(detailHead)
      detail.appendChild(detailBar)
      const detailBody = el('div', 'apv-detail-body')
      detail.appendChild(detailBody)
      body.appendChild(detail)
      view.appendChild(body)
      let selectedUrl = ''
      let currentFull = null
      let bodyQuery = ''
      let selectedId = null // 详情打开的那一行：高亮标记 + 列表继续刷新时保持原位
      const bodySections = [] // {render(query)}

      // -------------------------------------------------------------- state
      const PREFS_KEY = 'dsh-apiviz.prefs'
      function loadPrefs() {
        try {
          return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}
        } catch {
          return {}
        }
      }
      function savePrefs() {
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify({ autoScroll: state.autoScroll, autoCapture: autoCapCb.checked, logPath: logPathIn.value.trim(), savedFilters: state.savedFilters }))
        } catch {
          // storage unavailable
        }
      }
      const initialPrefs = loadPrefs()

      const state = {
        open: false,
        q: '',
        method: '',
        status: '',
        source: '',
        flagged: false,
        host: '',
        ct: '',
        minDur: '',
        errorsOnly: false,
        noNoise: false,
        regex: false,
        bodyQ: '',
        aggView: false,
        savedFilters: Array.isArray(initialPrefs.savedFilters) ? initialPrefs.savedFilters : [],
        timer: null,
        lastRenderKey: '',
        capture: { running: false, status: null, staleCount: 0, prevLogSize: null },
        proxy: { running: false, status: null },
        autoScroll: initialPrefs.autoScroll !== false,
      }

      // ---------------- P0-3 body multi-view sections

      function detectBodyKind(text, contentType) {
        const ct = String(contentType ?? '').toLowerCase()
        if (text.startsWith('base64:')) {
          const semi = text.indexOf(';', 7)
          return { kind: 'base64', mime: semi > 0 ? text.slice(7, semi) : 'application/octet-stream', data: semi > 0 ? text.slice(semi + 1) : text.slice(7) }
        }
        if (text.startsWith('hex:')) return { kind: 'hex', data: text.slice(4) }
        if (ct.includes('image/')) return { kind: 'image', mime: ct.split(';')[0].trim() }
        if (ct.includes('html')) return { kind: 'html' }
        if (ct.includes('json') || /^\s*[[{]/.test(text)) return { kind: 'json' }
        if (ct.includes('xml')) return { kind: 'xml' }
        return { kind: 'text' }
      }

      function hexDumpText(s) {
        const bytes = []
        for (let i = 0; i < s.length; i += 2) {
          const b = Number.parseInt(s.slice(i, i + 2), 16)
          if (!Number.isNaN(b)) bytes.push(b)
        }
        return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
      }

      /** Build one body section with Pretty/Raw/树/预览/图片 views; returns re-render fn. */
      function makeBodySection(title, text, contentType, parent) {
        const info = detectBodyKind(text, contentType)
        const truncated = text.endsWith('…(截断)')
        const sec = el('div', 'apv-sec')
        const secTitle = el('div', 'apv-sec-title')
        secTitle.appendChild(el('span', 'apv-t', title + (truncated ? ' (已截断)' : '')))
        const viewBtns = el('div', 'apv-viewbtns')
        secTitle.appendChild(viewBtns)
        const container = el('div', 'apv-sec-body')
        sec.appendChild(secTitle)
        sec.appendChild(container)
        parent.appendChild(sec)

        const base = () => (truncated ? text.slice(0, -5) : text)
        let mode
        if (info.kind === 'json') mode = 'pretty'
        else if (info.kind === 'base64' || info.kind === 'image') mode = 'image'
        else if (info.kind === 'hex') mode = 'hex'
        else mode = 'raw'

        const setMode = (m) => {
          mode = m
          for (const b of viewBtns.children) {
            if (b.dataset.mode === m) b.classList.add('apv-btn-on')
            else b.classList.remove('apv-btn-on')
          }
          render()
        }
        const addBtn = (label, m) => {
          const b = el('button', 'apv-btn', label)
          b.dataset.mode = m
          b.addEventListener('click', () => setMode(m))
          viewBtns.appendChild(b)
        }
        if (info.kind === 'json') {
          addBtn('Pretty', 'pretty')
          addBtn('Raw', 'raw')
          addBtn('树', 'tree')
        } else if (info.kind === 'base64' || info.kind === 'image') {
          addBtn('图片', 'image')
          addBtn('Raw', 'raw')
        } else if (info.kind === 'hex') {
          addBtn('十六进制', 'hex')
          addBtn('Raw', 'raw')
        } else if (info.kind === 'html') {
          addBtn('Raw', 'raw')
          addBtn('预览', 'preview')
        } else {
          addBtn('Raw', 'raw')
        }

        const render = () => {
          container.textContent = ''
          const t = base()
          if (mode === 'raw') {
            container.appendChild(highlightedPre(text, bodyQuery))
          } else if (mode === 'pretty') {
            try {
              container.appendChild(highlightedPre(JSON.stringify(JSON.parse(t), null, 2), bodyQuery))
            } catch {
              container.appendChild(highlightedPre(/^\s*[[{]/.test(t) ? prettyJsonFragment(t) : text, bodyQuery))
            }
          } else if (mode === 'tree') {
            try {
              container.appendChild(jsonTreeEl(JSON.parse(t)))
            } catch {
              container.appendChild(highlightedPre('(JSON 不完整，无法建树，请切到 Pretty)', bodyQuery))
            }
          } else if (mode === 'image') {
            const img = el('img', 'apv-img')
            img.alt = '响应图片'
            img.src = info.kind === 'base64' ? `data:${info.mime};base64,${info.data}` : text
            container.appendChild(img)
          } else if (mode === 'preview') {
            const frame = el('iframe', 'apv-iframe')
            frame.sandbox = ''
            frame.srcdoc = t
            container.appendChild(frame)
          } else if (mode === 'hex') {
            container.appendChild(highlightedPre(info.kind === 'hex' ? hexDumpText(info.data) : 'hex: (无内容)', bodyQuery))
          }
        }
        setMode(mode)
        return render
      }

      /** Meta/headers pre section (no body views). */
      function makePreSection(title, content) {
        const sec = el('div', 'apv-sec')
        const secTitle = el('div', 'apv-sec-title')
        secTitle.appendChild(el('span', 'apv-t', title))
        sec.appendChild(secTitle)
        sec.appendChild(highlightedPre(content, ''))
        return sec
      }

      let replayWrap = null

      function renderDetail(full) {
        currentFull = full
        selectedUrl = full.url
        detailTitle.textContent = `${full.method} ${full.url}`
        bodySections.length = 0
        detailBody.textContent = ''
        replayWrap = null
        const meta = {
          method: full.method,
          url: full.url,
          status: full.status,
          time: Number.isFinite(full.ts) ? new Date(full.ts).toLocaleString() : undefined,
          source: full.source,
          durationMs: full.durationMs,
          process: full.process,
          id: full.id,
        }
        detailBody.appendChild(makePreSection('基本信息', JSON.stringify(meta, null, 2)))
        if (full.reqHeaders !== undefined) detailBody.appendChild(makePreSection('请求头', JSON.stringify(full.reqHeaders, null, 2)))
        if (typeof full.reqBody === 'string' && full.reqBody !== '') {
          bodySections.push(makeBodySection('请求体', full.reqBody, (full.reqHeaders ?? {})['content-type'], detailBody))
        }
        if (full.resHeaders !== undefined) detailBody.appendChild(makePreSection('响应头', JSON.stringify(full.resHeaders, null, 2)))
        if (typeof full.resBody === 'string' && full.resBody !== '') {
          bodySections.push(makeBodySection('响应体', full.resBody, (full.resHeaders ?? {})['content-type'], detailBody))
        }
        noteInput.value = full.note ?? ''
        tagInput.value = full.tag ?? ''
      }

      function renderReplayResult(response) {
        if (replayWrap === null) {
          replayWrap = el('div', 'apv-sec')
          replayWrap.appendChild(el('div', 'apv-sec-title', '重放结果'))
          detailBody.insertBefore(replayWrap, detailBody.firstChild)
        }
        replayWrap.querySelectorAll('.apv-replay-bar, .apv-sec-body').forEach((n) => n.remove())
        const bar = el('div', 'apv-replay-bar')
        if (response && response.ok) {
          bar.appendChild(statusBadge(response.status))
          bar.appendChild(el('span', 'apv-note', `${response.statusText ?? ''} · ${fmtDur(response.durationMs)} · ${response.truncated ? '已截断' : ''}`))
        } else {
          bar.appendChild(el('span', 'apv-note', `失败: ${(response && response.error) || '未知错误'}`))
        }
        replayWrap.appendChild(bar)
        if (typeof response?.body === 'string' && response.body !== '') {
          const container = el('div', 'apv-sec-body')
          const kind = detectBodyKind(response.body, response.contentType ?? '')
          try {
            if (kind.kind === 'json') container.appendChild(highlightedPre(JSON.stringify(JSON.parse(response.body), null, 2), bodyQuery))
            else container.appendChild(highlightedPre(response.body, bodyQuery))
          } catch {
            container.appendChild(highlightedPre(response.body, bodyQuery))
          }
          replayWrap.appendChild(container)
        }
      }

      const closeDetail = () => {
        detail.hidden = true
        selectedId = null
        detailBody.textContent = ''
        bodySections.length = 0
        currentFull = null
        replayWrap = null
      }
      detailClose.addEventListener('click', closeDetail)

      copyUrlBtn.addEventListener('click', () => {
        if (selectedUrl !== '') copyText(selectedUrl, copyUrlBtn, '复制 URL')
      })
      copyAsBtn.addEventListener('click', () => {
        if (currentFull === null) return
        copyText(buildSnippet(copyAsSel.value, currentFull), copyAsBtn, '复制为')
      })
      replayBtn.addEventListener('click', () => {
        if (currentFull === null) return
        replayBtn.disabled = true
        replayBtn.textContent = '重放中…'
        const payload = {
          method: currentFull.method,
          url: currentFull.url,
          headers: currentFull.reqHeaders ?? {},
          body: currentFull.reqBody ?? '',
          timeoutMs: 30000,
        }
        fetch('/api/dsh-postman/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((r) => r.json())
          .then((data) => renderReplayResult(data.response))
          .catch((error) => renderReplayResult({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          .finally(() => {
            replayBtn.disabled = false
            replayBtn.textContent = '重放'
          })
      })
      openPmBtn.addEventListener('click', () => {
        if (currentFull === null) return
        window.dispatchEvent(
          new CustomEvent('dsh-postman:prefill', {
            detail: {
              method: currentFull.method,
              url: currentFull.url,
              headers: currentFull.reqHeaders ?? {},
              body: currentFull.reqBody ?? '',
            },
          }),
        )
      })
      bodySearch.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return
        bodyQuery = bodySearch.value
        for (const render of bodySections) render()
        const firstMark = detailBody.querySelector('.apv-mark')
        if (firstMark !== null) firstMark.scrollIntoView({ block: 'center' })
      })
      saveNoteBtn.addEventListener('click', () => {
        if (currentFull === null) return
        const patch = { note: noteInput.value, tag: tagInput.value }
        saveNoteBtn.disabled = true
        apiFetch(`/records/${encodeURIComponent(currentFull.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
          .then((rec) => {
            currentFull = rec
            renderDetail(rec)
            refresh()
          })
          .catch((error) => {
            console.error('[dsh-api-visualizer] patch failed:', error)
          })
          .finally(() => {
            saveNoteBtn.disabled = false
          })
      })
      delRecordBtn.addEventListener('click', () => {
        if (currentFull === null) return
        if (!window.confirm(`删除这条记录？\n${currentFull.method} ${currentFull.url}`)) return
        delRecordBtn.disabled = true
        apiFetch(`/records/${encodeURIComponent(currentFull.id)}`, { method: 'DELETE' })
          .then(() => {
            closeDetail()
            refresh()
          })
          .catch((error) => {
            console.error('[dsh-api-visualizer] delete record failed:', error)
          })
          .finally(() => {
            delRecordBtn.disabled = false
          })
      })

      async function toggleFlag(rec, starBtn) {
        try {
          const updated = await apiFetch(`/records/${encodeURIComponent(rec.id)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ flag: !rec.flag }),
          })
          rec.flag = updated.flag === true
          starBtn.textContent = rec.flag ? '★' : '☆'
          starBtn.dataset.on = rec.flag ? '1' : '0'
          if (currentFull !== null && currentFull.id === rec.id) currentFull.flag = rec.flag
        } catch (error) {
          console.error('[dsh-api-visualizer] flag failed:', error)
        }
      }

      const renderStats = (s) => {
        const parts = [`共 ${s.total} 条`]
        if (s.lastTs !== null) parts.push(`最新 ${fmtTime(s.lastTs)}`)
        for (const [m, n] of Object.entries(s.byMethod)) parts.push(`${m} ${n}`)
        stats.textContent = parts.join(' · ')
        // source filter options from live data
        const keys = Object.keys(s.bySource)
        const current = sourceSel.value
        const want = keys.includes(current) ? current : ''
        sourceSel.textContent = ''
        const all = el('option', '', '来源:全部')
        all.value = ''
        sourceSel.appendChild(all)
        for (const k of keys.sort()) {
          const opt = el('option', '', `${k} (${s.bySource[k]})`)
          opt.value = k
          sourceSel.appendChild(opt)
        }
        if (want !== '') sourceSel.value = want
        state.source = want
      }

      /** Render the capture-engine chip + toggle + sidebar live dot. */
      const renderCapture = (cap) => {
        state.capture.status = cap
        const running = cap !== null && cap.running === true
        state.capture.running = running
        if (running) {
          const counters = cap.counters ?? {}
          const size = typeof cap.logSize === 'number' ? `${(cap.logSize / 1048576).toFixed(1)}MB` : '-'
          captureChip.textContent =
            `● 监听中 · 实时入库 ${cap.storeRealtime ?? counters.emitted ?? 0} 条 · 日志 ${size}`
          captureChip.className = 'apv-stats apv-live-on'
          captureBtn.textContent = '停止实时捕获'
          captureBtn.classList.add('apv-capture-on')
          // 健康检查：日志 3 个轮询周期无增长 → 提示注入可能未生效
          if (typeof cap.logSize === 'number' && cap.logSize === state.capture.prevLogSize && cap.logSize > 0) {
            state.capture.staleCount += 1
          } else {
            state.capture.staleCount = 0
          }
          state.capture.prevLogSize = cap.logSize
          if (state.capture.staleCount >= 3) {
            captureChip.className = 'apv-stats'
            captureChip.style.color = '#fbbf24'
            healthHint.textContent = '警告：跟踪日志近几秒没有增长——客户端 system.diagnostics 注入可能未生效（改配置后需重启客户端；原始日志在 %TEMP%\\uiprobe-net-trace.log）。'
            healthHint.style.color = '#fbbf24'
          } else {
            healthHint.textContent = ''
          }
        } else {
          captureChip.style.color = ''
          captureChip.textContent = cap === null ? '○ 捕获引擎不可用' : `○ 已停止 · 实时共 ${cap.storeRealtime ?? 0} 条`
          captureChip.className = 'apv-stats'
          captureBtn.textContent = '开始实时捕获'
          captureBtn.classList.remove('apv-capture-on')
          healthHint.textContent = ''
          state.capture.staleCount = 0
          state.capture.prevLogSize = null
        }
        if (liveDot !== null) liveDot.dataset.on = running ? '1' : '0'
      }

      /** Render the local-proxy chip + toggles. */
      const renderProxy = (cap) => {
        state.proxy.status = cap
        const running = cap !== null && cap.running === true
        state.proxy.running = running
        if (running) {
          proxyChip.textContent =
            `代理 ● 127.0.0.1:${cap.port} · 上游 ${cap.upstream ?? '直连'} · 已抓 ${cap.counters?.requests ?? 0} · HTTPS解密 ${cap.counters?.mitm ?? 0}`
          proxyChip.className = 'apv-stats apv-live-on'
          proxyBtn.textContent = '停止代理'
          proxyBtn.classList.add('apv-capture-on')
        } else {
          proxyChip.textContent = cap === null ? '代理引擎不可用' : `代理 ○ 未启动${cap.caReady ? ' · 证书就绪' : ''}`
          proxyChip.className = 'apv-stats'
          proxyBtn.textContent = '启动代理'
          proxyBtn.classList.remove('apv-capture-on')
        }
        const sysActive = cap !== null && cap.systemProxyActive === true
        sysProxyBtn.textContent = sysActive ? '取消系统代理' : '设为系统代理'
        sysProxyBtn.classList.toggle('apv-capture-on', sysActive)
      }

      const renderRows = (records) => {
        tbody.textContent = ''
        if (records.length === 0) {
          const row = el('tr')
          const cell = el('td', 'apv-empty', '暂无记录 — 点击「开始实时捕获」，客户端流量会像 Fiddler 一样实时流进来；也可用 api_capture_append 手动上报')
          cell.colSpan = 8
          row.appendChild(cell)
          tbody.appendChild(row)
          return
        }
        for (const r of records) {
          const tr = el('tr')
          if (r.id === selectedId) tr.classList.add('apv-selected')
          const starTd = el('td')
          const starBtn = el('button', 'apv-star', r.flag === true ? '★' : '☆')
          starBtn.dataset.on = r.flag === true ? '1' : '0'
          starBtn.title = '标记/取消标记'
          starBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            toggleFlag(r, starBtn)
          })
          starTd.appendChild(starBtn)
          tr.appendChild(starTd)
          tr.appendChild(el('td', '', fmtTime(r.ts)))
          const methodTd = el('td')
          methodTd.appendChild(methodBadge(r.method))
          tr.appendChild(methodTd)
          const urlTd = el('td', '', r.url)
          urlTd.title = r.url
          tr.appendChild(urlTd)
          const statusTd = el('td')
          statusTd.appendChild(statusBadge(r.status))
          tr.appendChild(statusTd)
          tr.appendChild(el('td', '', fmtDur(r.durationMs)))
          tr.appendChild(el('td', 'apv-note', r.source ?? '-'))
          tr.appendChild(el('td', 'apv-note', r.note ?? ''))
          tr.addEventListener('click', () => {
            selectedId = r.id
            tbody.querySelectorAll('tr.apv-selected').forEach((node) => node.classList.remove('apv-selected'))
            tr.classList.add('apv-selected')
            apiFetch(`/records/${encodeURIComponent(r.id)}`).then((full) => {
              renderDetail(full)
              detail.hidden = false
            }).catch((error) => { console.error('[dsh-api-visualizer] detail failed:', error) })
          })
          tbody.appendChild(tr)
        }
        if (state.autoScroll && detail.hidden) tableWrap.scrollTop = tableWrap.scrollHeight
      }

      /** Render the aggregate (endpoints) view. */
      const renderAgg = (data) => {
        aggBodyEl.textContent = ''
        if (data.items.length === 0) {
          aggBodyEl.appendChild(el('tr'))
          aggBodyEl.lastChild.appendChild(el('td', 'apv-empty', '暂无数据'))
          aggBodyEl.lastChild.firstChild.colSpan = 8
          return
        }
        for (const e of data.items) {
          const tr = el('tr')
          const epTd = el('td')
          const m = el('span', 'apv-badge apv-m-' + (e.method === 'GET' ? 'get' : e.method === 'POST' ? 'post' : 'other'), e.method)
          epTd.appendChild(m)
          epTd.appendChild(document.createTextNode(' ' + e.path))
          tr.appendChild(epTd)
          tr.appendChild(el('td', '', String(e.count)))
          const errTd = el('td')
          errTd.textContent = e.errors > 0 ? `${(e.errorRate * 100).toFixed(1)}% (${e.errors})` : '0'
          if (e.errors > 0) errTd.style.color = '#f87171'
          tr.appendChild(errTd)
          tr.appendChild(el('td', '', e.avgMs === null ? '-' : fmtDur(e.avgMs)))
          tr.appendChild(el('td', '', e.p95Ms === null ? '-' : fmtDur(e.p95Ms)))
          tr.appendChild(el('td', '', e.maxMs === null ? '-' : fmtDur(e.maxMs)))
          tr.appendChild(el('td', '', e.lastStatus === null || e.lastStatus === undefined ? '-' : String(e.lastStatus)))
          const sampleTd = el('td', '', e.sampleUrl ?? '')
          sampleTd.title = e.sampleUrl ?? ''
          tr.appendChild(sampleTd)
          tr.addEventListener('click', () => {
            setAggView(false)
            q.value = e.path
            state.q = e.path
            refresh()
          })
          aggBodyEl.appendChild(tr)
        }
      }

      const setAggView = (on) => {
        state.aggView = on
        aggWrap.hidden = !on
        tableWrap.hidden = on
        if (on) {
          aggBtn.classList.add('apv-btn-on')
          apiFetch('/stats/endpoints').then(renderAgg).catch((error) => {
            aggBodyEl.textContent = ''
            aggBodyEl.appendChild(el('tr'))
            aggBodyEl.lastChild.appendChild(el('td', 'apv-empty', '聚合加载失败: ' + (error instanceof Error ? error.message : String(error))))
            aggBodyEl.lastChild.firstChild.colSpan = 8
          })
        } else {
          aggBtn.classList.remove('apv-btn-on')
        }
      }

      const refresh = async () => {
        try {
          const params = new URLSearchParams({ limit: String(LIMIT) })
          if (state.q !== '') params.set('q', state.q)
          if (state.method !== '') params.set('method', state.method)
          if (state.status !== '') params.set('status', state.status)
          if (state.source !== '') params.set('source', state.source)
          if (state.flagged) params.set('flag', '1')
          if (state.host !== '') params.set('host', state.host)
          if (state.ct !== '') params.set('contentType', state.ct)
          if (state.minDur !== '') params.set('minDurationMs', state.minDur)
          if (state.errorsOnly) params.set('errors', '1')
          if (state.noNoise) params.set('noNoise', '1')
          if (state.regex) params.set('regex', '1')
          if (state.bodyQ !== '') params.set('bodyQ', state.bodyQ)
          const [list, stat, cap, prox] = await Promise.all([
            apiFetch(`/records?${params.toString()}`),
            apiFetch('/stats'),
            apiFetch('/capture/status').catch(() => null),
            apiFetch('/proxy/status').catch(() => null),
          ])
          renderStats(stat)
          renderCapture(cap)
          renderProxy(prox)
          const key = `${stat.total}|${stat.lastTs}|${state.q}|${state.method}|${state.status}|${state.source}|${state.flagged}|${state.host}|${state.ct}|${state.minDur}|${state.errorsOnly}|${state.noNoise}|${state.regex}|${state.bodyQ}|${state.aggView}`
          if (key !== state.lastRenderKey) {
            state.lastRenderKey = key
            if (state.aggView) {
              apiFetch('/stats/endpoints').then(renderAgg).catch(() => {})
            } else {
              renderRows(list.items)
            }
          }
        } catch (error) {
          stats.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      const scheduleNext = () => {
        state.timer = setTimeout(() => {
          refresh().finally(scheduleNext)
        }, state.capture.running || state.proxy.running ? POLL_LIVE_MS : POLL_MS)
      }

      const setOpen = (open) => {
        state.open = open
        if (open) {
          // exclusive with sibling panels
          delete document.documentElement.dataset.dshTaskboardActive
          delete document.documentElement.dataset.dshSshActive
          delete document.documentElement.dataset.dshPostmanActive
          document.documentElement.dataset.dshApivizActive = 'true'
          refresh().finally(scheduleNext)
          // 偏好：打开面板即自动开始捕获（未运行时）
          if (autoCapCb.checked && !state.capture.running) {
            const logPath = logPathIn.value.trim()
            apiFetch('/capture/start', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(logPath !== '' ? { logPath } : {}),
            })
              .then((cap) => renderCapture(cap))
              .catch(() => {})
          }
        } else {
          document.documentElement.removeAttribute('data-dsh-apiviz-active')
          if (state.timer !== null) {
            clearTimeout(state.timer)
            state.timer = null
          }
          closeDetail()
        }
      }
      const toggle = () => setOpen(document.documentElement.dataset.dshApivizActive !== 'true')

      closeBtn.addEventListener('click', () => setOpen(false))
      refreshBtn.addEventListener('click', refresh)
      captureBtn.addEventListener('click', () => {
        const path = state.capture.running ? '/capture/stop' : '/capture/start'
        captureBtn.disabled = true
        const logPath = logPathIn.value.trim()
        apiFetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(logPath !== '' ? { logPath } : {}),
        })
          .then((cap) => renderCapture(cap))
          .catch((error) => {
            console.error('[dsh-api-visualizer] capture toggle failed:', error)
            captureChip.textContent = `捕获操作失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            captureBtn.disabled = false
            refresh()
          })
      })
      autoScrollCb.addEventListener('change', () => {
        state.autoScroll = autoScrollCb.checked
        if (state.autoScroll) tableWrap.scrollTop = tableWrap.scrollHeight
        savePrefs()
      })
      flaggedBtn.addEventListener('click', () => {
        state.flagged = !state.flagged
        if (state.flagged) flaggedBtn.classList.add('apv-btn-on')
        else flaggedBtn.classList.remove('apv-btn-on')
        refresh()
      })
      moreBtn.addEventListener('click', () => {
        filterBar.hidden = !filterBar.hidden
        moreBtn.textContent = filterBar.hidden ? '更多 ▾' : '更多 ▴'
      })
      const applyAdvInputs = () => {
        state.host = hostIn.value.trim()
        state.ct = ctIn.value.trim()
        state.minDur = minDurIn.value.trim()
        state.bodyQ = bodyQIn.value.trim()
        refresh()
      }
      for (const input of [hostIn, ctIn, minDurIn, bodyQIn]) {
        input.addEventListener('change', applyAdvInputs)
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') applyAdvInputs()
        })
      }
      errorsCb.addEventListener('change', () => {
        state.errorsOnly = errorsCb.checked
        refresh()
      })
      noiseCb.addEventListener('change', () => {
        state.noNoise = noiseCb.checked
        refresh()
      })
      regexCb.addEventListener('change', () => {
        state.regex = regexCb.checked
        refresh()
      })
      aggBtn.addEventListener('click', () => setAggView(!state.aggView))
      delFilteredBtn.addEventListener('click', () => {
        if (!window.confirm('删除当前筛选条件命中的全部记录？此操作不可恢复。')) return
        const params = new URLSearchParams({ filtered: '1' })
        if (state.q !== '') params.set('q', state.q)
        if (state.method !== '') params.set('method', state.method)
        if (state.status !== '') params.set('status', state.status)
        if (state.source !== '') params.set('source', state.source)
        if (state.flagged) params.set('flag', '1')
        if (state.host !== '') params.set('host', state.host)
        if (state.ct !== '') params.set('contentType', state.ct)
        if (state.minDur !== '') params.set('minDurationMs', state.minDur)
        if (state.errorsOnly) params.set('errors', '1')
        if (state.noNoise) params.set('noNoise', '1')
        if (state.regex) params.set('regex', '1')
        if (state.bodyQ !== '') params.set('bodyQ', state.bodyQ)
        apiFetch(`/records?${params.toString()}`, { method: 'DELETE' })
          .then((r) => {
            stats.textContent = `已删除 ${r.deleted} 条`
            refresh()
          })
          .catch((error) => console.error('[dsh-api-visualizer] delete filtered failed:', error))
      })
      // 保存/载入筛选
      const currentFilter = () => ({
        q: state.q, method: state.method, status: state.status, source: state.source, flagged: state.flagged,
        host: state.host, ct: state.ct, minDur: state.minDur, errorsOnly: state.errorsOnly, noNoise: state.noNoise, regex: state.regex, bodyQ: state.bodyQ,
      })
      const applyFilter = (f) => {
        q.value = f.q ?? ''
        state.q = f.q ?? ''
        methodSel.value = f.method ?? ''
        state.method = f.method ?? ''
        statusSel.value = f.status ?? ''
        state.status = f.status ?? ''
        sourceSel.value = f.source ?? ''
        state.source = f.source ?? ''
        state.flagged = f.flagged === true
        flaggedBtn.classList.toggle('apv-btn-on', state.flagged)
        hostIn.value = f.host ?? ''
        state.host = f.host ?? ''
        ctIn.value = f.ct ?? ''
        state.ct = f.ct ?? ''
        minDurIn.value = f.minDur ?? ''
        state.minDur = f.minDur ?? ''
        errorsCb.checked = f.errorsOnly === true
        state.errorsOnly = f.errorsOnly === true
        noiseCb.checked = f.noNoise === true
        state.noNoise = f.noNoise === true
        regexCb.checked = f.regex === true
        state.regex = f.regex === true
        bodyQIn.value = f.bodyQ ?? ''
        state.bodyQ = f.bodyQ ?? ''
        refresh()
      }
      const renderSavedSel = () => {
        savedSel.textContent = ''
        const all = el('option', '', state.savedFilters.length === 0 ? '(无已保存筛选)' : '载入筛选…')
        all.value = ''
        savedSel.appendChild(all)
        for (const f of state.savedFilters) {
          const opt = el('option', '', f.name)
          opt.value = f.name
          savedSel.appendChild(opt)
        }
      }
      savedSel.addEventListener('change', () => {
        const f = state.savedFilters.find((s) => s.name === savedSel.value)
        if (f !== undefined) applyFilter(f.filter)
      })
      saveFilterBtn.addEventListener('click', () => {
        const name = window.prompt('给这个筛选起个名字：', '筛选 ' + (state.savedFilters.length + 1))
        if (name === null || name.trim() === '') return
        const idx = state.savedFilters.findIndex((s) => s.name === name.trim())
        if (idx >= 0) state.savedFilters[idx] = { name: name.trim(), filter: currentFilter() }
        else state.savedFilters.push({ name: name.trim(), filter: currentFilter() })
        savePrefs()
        renderSavedSel()
      })
      delSavedBtn.addEventListener('click', () => {
        if (savedSel.value === '') return
        state.savedFilters = state.savedFilters.filter((s) => s.name !== savedSel.value)
        savePrefs()
        renderSavedSel()
      })
      autoCapCb.addEventListener('change', savePrefs)
      logPathIn.addEventListener('change', savePrefs)
      clearLogsBtn.addEventListener('click', () => {
        if (!window.confirm('清除日志：删除客户端跟踪日志（客户端运行时自动跳过）与抓包目录的日志文件？')) return
        clearLogsBtn.disabled = true
        healthHint.style.color = ''
        healthHint.textContent = '正在清理日志…'
        apiFetch('/logs/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then((r) => {
            if (r.traceLogDeleted) healthHint.textContent = '已清除：跟踪日志与抓包目录日志'
            else if (r.traceLogSkipped) {
              healthHint.textContent = '抓包目录日志已清；跟踪日志被客户端占用已跳过（重启客户端后可清）'
              healthHint.style.color = '#fbbf24'
            } else healthHint.textContent = r.ok ? '清理完成' : `清理失败: ${r.err ?? r.output ?? '未知'}`
          })
          .catch((error) => {
            healthHint.textContent = `清理失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            clearLogsBtn.disabled = false
          })
      })
      proxyBtn.addEventListener('click', () => {
        const path = state.proxy.running ? '/proxy/stop' : '/proxy/start'
        const port = Math.max(1, Math.min(65535, Number(portInput.value) || 8899))
        proxyBtn.disabled = true
        apiFetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ port }),
        })
          .then((cap) => renderProxy(cap))
          .catch((error) => {
            console.error('[dsh-api-visualizer] proxy toggle failed:', error)
            proxyChip.textContent = `代理操作失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            proxyBtn.disabled = false
            refresh()
          })
      })
      caBtn.addEventListener('click', () => {
        caBtn.disabled = true
        proxyChip.textContent = '正在导入根证书…'
        apiFetch('/proxy/install-ca', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then((r) => {
            proxyChip.textContent = r.ok === true ? '根证书已导入本机信任（当前用户）' : `导入结果: ${r.output ?? '未知'}`
          })
          .catch((error) => {
            console.error('[dsh-api-visualizer] install-ca failed:', error)
            proxyChip.textContent = `导入失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            caBtn.disabled = false
            refresh()
          })
      })
      sysProxyBtn.addEventListener('click', () => {
        const enable = !(state.proxy.status?.systemProxyActive === true)
        sysProxyBtn.disabled = true
        proxyChip.textContent = enable ? '正在把系统代理指向本代理…' : '正在恢复系统代理…'
        apiFetch('/proxy/system-proxy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enable }),
        })
          .then(() => refresh())
          .catch((error) => {
            console.error('[dsh-api-visualizer] system-proxy failed:', error)
            proxyChip.textContent = `系统代理操作失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            sysProxyBtn.disabled = false
          })
      })
      exportBtn.addEventListener('click', () => {
        const format = exportSel.value
        const redact = exportRedactCb.checked
        exportBtn.disabled = true
        exportBtn.textContent = '导出中…'
        const params = new URLSearchParams({ limit: '2000', includeBody: '1' })
        if (state.q !== '') params.set('q', state.q)
        if (state.method !== '') params.set('method', state.method)
        if (state.status !== '') params.set('status', state.status)
        if (state.source !== '') params.set('source', state.source)
        if (state.flagged) params.set('flag', '1')
        apiFetch(`/records?${params.toString()}`)
          .then((data) => {
            const items = (data.items ?? []).map((r) => (redact ? redactRecord(r) : r))
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
            if (format === 'HAR') {
              downloadBlob(`api-capture-${stamp}.har`, JSON.stringify(buildHar(items), null, 2), 'application/json')
            } else if (format === 'JSON') {
              downloadBlob(`api-capture-${stamp}.json`, JSON.stringify(items, null, 2), 'application/json')
            } else {
              const esc = (v) => {
                const s = v === null || v === undefined ? '' : String(v)
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
              }
              const head = ['ts', 'method', 'url', 'status', 'durationMs', 'source', 'note', 'tag'].join(',')
              const rows = items.map((r) => [r.ts ?? '', r.method ?? '', esc(r.url ?? ''), r.status ?? '', r.durationMs ?? '', r.source ?? '', esc(r.note ?? ''), esc(r.tag ?? '')].join(','))
              downloadBlob(`api-capture-${stamp}.csv`, '\ufeff' + [head, ...rows].join('\n'), 'text/csv;charset=utf-8')
            }
          })
          .catch((error) => {
            console.error('[dsh-api-visualizer] export failed:', error)
            stats.textContent = `导出失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            exportBtn.disabled = false
            exportBtn.textContent = '导出'
          })
      })
      clearBtn.addEventListener('click', () => {
        if (window.confirm('清空全部接口捕获记录？')) {
          apiFetch('/records', { method: 'DELETE' }).then(() => refresh()).catch((error) => {
            console.error('[dsh-api-visualizer] clear failed:', error)
          })
        }
      })
      q.addEventListener('input', () => {
        state.q = q.value.trim()
        refresh()
      })
      methodSel.addEventListener('change', () => {
        state.method = methodSel.value
        refresh()
      })
      statusSel.addEventListener('change', () => {
        state.status = statusSel.value
        refresh()
      })
      sourceSel.addEventListener('change', () => {
        state.source = sourceSel.value
        refresh()
      })
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.open) setOpen(false)
      })

      // ---- prefs init (P2-14 部分持久化)
      autoScrollCb.checked = state.autoScroll
      autoCapCb.checked = initialPrefs.autoCapture === true
      logPathIn.value = typeof initialPrefs.logPath === 'string' ? initialPrefs.logPath : ''
      renderSavedSel()

      return { view, toggle, setOpen }
    }

    // ------------------------------------------ cross-plugin: postman 返回按钮

    /**
     * 在「接口调试」面板工具栏注入「← 接口捕获」按钮（纯 DOM 注入，不改 postman 文件）。
     * 点击打开接口捕获面板；接口捕获 setOpen 会清掉 postman 的 active 标记，postman 面板随之隐藏。
     */
    function injectPostmanBackBtn(openCapture) {
      if (typeof document === 'undefined') return () => {}
      const tryInject = () => {
        const pmView = document.querySelector('[data-dsh-postman-view]')
        if (pmView === null) return
        const toolbar = pmView.querySelector('.pm-toolbar')
        if (toolbar === null) return
        if (toolbar.querySelector('[data-apv-back-entry]') !== null) return
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.dataset.apvBackEntry = ''
        btn.title = '返回「接口捕获」面板'
        btn.textContent = '← 接口捕获'
        btn.addEventListener('click', () => {
          // 必须直接 setOpen(true)：postman 打开时会清掉 active 标记但改不到我的
          // 内部 state，此时再点侧边栏入口会先“关”一次，表现为要点两下。
          openCapture(true)
        })
        const close = toolbar.querySelector('.pm-close')
        if (close !== null) toolbar.insertBefore(btn, close)
        else toolbar.appendChild(btn)
      }
      const obs = new MutationObserver(tryInject)
      obs.observe(document.body, { childList: true, subtree: true })
      tryInject()
      return () => obs.disconnect()
    }

    // ------------------------------------------------------------------ apply

    let applied = false

    /**
     * Mount the sidebar entry and panel.
     * @param ctx - client root context (unused; the plugin talks to the host
     * via plain same-origin fetch).
     */
    function apply(ctx) {
      if (applied) return
      applied = true
      try {
        injectStyle()
        const { view, toggle, setOpen } = buildPanel()
        const disposers = []
        try {
          disposers.push(mountSidebarEntry(toggle))
          disposers.push(injectPostmanBackBtn(setOpen))
          const column = centerColumn()
          column.appendChild(view)
          disposers.push(() => view.remove())
        } catch (error) {
          console.error('[dsh-api-visualizer] mount failed:', error)
        }
        ctx.effect(() => () => { for (const dispose of disposers.splice(0)) dispose() }, 'dsh-api-visualizer: teardown')
      } catch (error) {
        // never take the GUI down
        console.error('[dsh-api-visualizer] apply failed:', error)
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
