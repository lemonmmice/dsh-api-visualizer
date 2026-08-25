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
.apv-statchip{cursor:pointer;border-radius:4px;padding:0 4px}
.apv-statchip:hover{background:var(--dsw-alias-interactive-bg-hover);text-decoration:underline}
.apv-statchip-on{background:var(--dsw-static-deepseek-100);color:var(--dsw-static-deepseek-700)}
body[data-ds-dark-theme] .apv-statchip-on{background:#1e2a44;color:#93c5fd}
.apv-q{flex:1 1 180px;min-width:120px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 8px;font:inherit}
.apv-select{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 6px;font:inherit}
.apv-btn{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.apv-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.apv-btn-danger:hover{border-color:#c0392b;color:#e74c3c}
.apv-close{margin-left:auto;font-size:16px;line-height:1;padding:4px 8px}
.apv-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;position:relative}
.apv-table-wrap{flex:1;min-height:0;overflow:auto}
.apv-table{min-width:100%;border-collapse:collapse;white-space:nowrap}
.apv-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);text-align:left;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l2);z-index:1}
.apv-table td{padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top;max-width:520px;overflow:hidden;text-overflow:ellipsis}
.apv-caller{color:var(--dsw-static-neutral-bluish-700);font-size:12px}
body[data-ds-dark-theme] .apv-caller{color:#c4a7f0}
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
.apv-difftable{border-collapse:collapse;width:100%;table-layout:fixed;font:12px/1.5 ui-monospace,Consolas,monospace}
.apv-difftable td{width:50%;vertical-align:top;white-space:pre-wrap;word-break:break-all;padding:0 6px;border-left:1px solid var(--dsw-alias-border-l2)}
.apv-diff-del{background:rgba(231,76,60,.18)}
.apv-diff-ins{background:rgba(46,204,113,.18)}
.apv-diff-blank{background:var(--dsw-alias-bg-layer-2)}
.apv-bp-paused{padding:4px 8px;overflow:auto}
.apv-bp-card{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}
.apv-bp-btns{display:flex;gap:8px;margin-top:6px}
.apv-detail{display:flex;flex:0 0 var(--apv-detail-height,42%);flex-direction:column;height:var(--apv-detail-height,42%);min-height:120px;max-height:85%;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l2)}
.apv-detail[hidden]{display:none}
.apv-detail-resize{height:8px;flex:0 0 8px;cursor:ns-resize;background:var(--dsw-alias-bg-base);border-top:1px solid var(--dsw-alias-border-l2);position:relative;touch-action:none;z-index:2}
.apv-detail-resize::after{content:"";position:absolute;left:50%;top:3px;width:42px;height:2px;transform:translateX(-50%);border-radius:2px;background:var(--dsw-alias-label-tertiary);opacity:.75}
.apv-detail-resize:hover,.apv-detail-resize:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.apv-detail-resize:hover::after,.apv-detail-resize:focus-visible::after{background:var(--dsw-static-deepseek-500);opacity:1}
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
.apv-detail-body{flex:1;min-height:0;overflow:auto;padding:0 12px 12px}
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
.apv-timeline-summary{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:4px 0 10px}
.apv-timeline-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.apv-timeline-help{flex:1 1 420px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.apv-timeline-table{min-width:980px}
.apv-timeline-table td,.apv-timeline-table th{font-variant-numeric:tabular-nums}
.apv-timeline-table tbody tr{cursor:default}
.apv-timeline-table .apv-timeline-range{color:var(--dsw-alias-label-primary);font-weight:600}
.apv-timeline-table .apv-timeline-muted{color:var(--dsw-alias-label-tertiary)}
.apv-timeline-table .apv-timeline-error{color:#f87171}
.apv-timeline-table .apv-timeline-tail{color:#fbbf24}
.apv-wf{display:flex;flex-direction:column;gap:2px}
.apv-wf-row{display:flex;align-items:center;gap:8px;padding:2px 0}
.apv-wf-meta{flex:0 0 320px;min-width:320px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.apv-wf-track{flex:1;position:relative;height:14px;background:var(--dsw-alias-bg-layer-2);border-radius:4px;overflow:hidden}
.apv-wf-bar{position:absolute;top:1px;height:12px;min-width:2px;border-radius:3px;background:#2f6f8f;cursor:pointer;overflow:hidden;display:flex}
.apv-wf-bar:hover{background:#3d87ad}
.apv-wf-ttfb{height:100%;background:#4a6a1f;flex:none}
.apv-wf-legend{display:flex;gap:14px;align-items:center;padding:4px 0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.apv-wf-legend i{display:inline-block;width:26px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.apv-wf-total{background:#2f6f8f}.apv-wf-wait{background:#4a6a1f}
.apv-src-hit{display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px}
.apv-src-hit:hover{background:var(--dsw-alias-interactive-bg-hover)}
.apv-src-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px Consolas,Menlo,monospace;color:#8ec5ff}
.apv-rules-table td,.apv-rules-table th{font-size:12px}
.apv-rules-form{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 0}
.apv-rules-form .apv-fin{flex:none}
.apv-rule-body{width:220px;height:44px;resize:vertical}
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

    function fmtBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '-'
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${Math.round(bytes)} B`
    }

    function fmtBucket(ms) {
      if (!Number.isFinite(ms)) return '-'
      if (ms % 3600000 === 0) return `${ms / 3600000} 小时`
      if (ms % 60000 === 0) return `${ms / 60000} 分钟`
      if (ms % 1000 === 0) return `${ms / 1000} 秒`
      return `${ms} 毫秒`
    }

    function headerValue(headers, name) {
      const key = Object.keys(headers ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
      return key === undefined ? undefined : headers[key]
    }

    function isFlagged(record) {
      return record?.flag === true || record?.flag === 1
    }

    function methodBadge(method) {
      const cls = { GET: 'apv-m-get', POST: 'apv-m-post', PUT: 'apv-m-put', DELETE: 'apv-m-delete' }[method] || 'apv-m-other'
      return el('span', 'apv-badge ' + cls, method)
    }

    function statusBadge(status) {
      if (!Number.isInteger(status)) return el('span', 'apv-badge apv-s-0', '-')
      return el('span', 'apv-badge apv-s-' + Math.floor(status / 100), String(status))
    }

    /**
     * 归一化调用栈用于展示：折叠异步状态机产生的相邻重复帧（a,a,b,b → a,b）。
     * 一个 async 方法在物理栈上是 MoveNext(状态机) + kickoff 两帧，Unwrap 后同名相邻，
     * 这里合并；保持原始「内→外」顺序（stack[0]=最靠近 HTTP 的帧，末尾=最外层入口）。
     */
    function normalizeStack(stack) {
      if (!Array.isArray(stack)) return []
      const out = []
      for (const f of stack) {
        if (typeof f !== 'string' || f === '') continue
        if (out.length > 0 && out[out.length - 1] === f) continue // 折叠相邻重复(异步双帧)
        out.push(f)
      }
      return out
    }

    /**
     * 完整调用链文本（入口 → 接口）。去重后按「外→内」排列，
     * 连续同类型帧省略重复的类型前缀，紧凑又可读。
     * 例：WatchListViewModel.OnRefresh → .LoadQuotes → QuoteApi.FetchSnapshot
     */
    function formatCallChain(stack) {
      const norm = normalizeStack(stack)
      if (norm.length === 0) return ''
      const parts = []
      let prevType = null
      for (const frame of norm.slice().reverse()) {
        const dot = frame.indexOf('.')
        const type = dot > 0 ? frame.slice(0, dot) : ''
        const method = dot > 0 ? frame.slice(dot + 1) : frame
        parts.push(type !== '' && type === prevType ? '.' + method : frame)
        prevType = type
      }
      return parts.join(' → ')
    }

    /**
     * One 调用方 (caller) table cell from a record.caller object.
     * 列表列直接展示完整调用链（入口→接口，已折叠异步重复帧）；tooltip 逐帧编号。
     * 无调用栈时回退到「谁 ← Api」，仍无则显示「-」。
     */
    function callerCell(c) {
      const td = el('td', 'apv-caller')
      const norm = c !== null && c !== undefined ? normalizeStack(c.stack) : []
      const hasStack = norm.length > 0
      if (c === null || c === undefined || (!c.viewModel && !c.view && !hasStack)) {
        td.textContent = '-'
        return td
      }
      const chain = hasStack ? formatCallChain(c.stack) : ''
      if (chain !== '') {
        td.textContent = chain
      } else {
        const who = c.viewModel || c.view || (norm.length > 0 ? norm[0] : '')
        let label = who
        if (c.viewModel && c.apiMethod && c.apiMethod !== who) label += ' ← ' + c.apiMethod
        td.textContent = label
      }
      const lines = []
      if (c.viewModel) lines.push('ViewModel: ' + c.viewModel)
      if (c.view) lines.push('View(约定): ' + c.view)
      if (c.apiMethod) lines.push('Api: ' + c.apiMethod)
      if (c.trigger) lines.push('触发: ' + c.trigger)
      if (hasStack) {
        lines.push('调用链(入口→接口):')
        norm.slice().reverse().forEach((f, i) => lines.push('  ' + (i + 1) + '. ' + f))
      }
      td.title = lines.join('\n')
      return td
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
              content: typeof r.resBody === 'string' ? { size: r.resBody.length, mimeType: headerValue(r.resHeaders, 'content-type') ?? 'text/plain', text: r.resBody } : { size: 0, mimeType: 'text/plain' },
            },
            cache: {},
            timings: { send: 0, wait: r.durationMs ?? 0, receive: 0 },
            comment: r.note ?? '',
          })),
        },
      }
    }

    function bodyJsonSchema(text, depth = 0) {
      if (typeof text !== 'string' || text.trim() === '' || depth > 6) return undefined
      let value
      try { value = JSON.parse(text) } catch { return undefined }
      const schema = (v, d) => {
        if (v === null) return { type: 'null' }
        if (Array.isArray(v)) return { type: 'array', items: v.length > 0 ? schema(v[0], d + 1) : {} }
        if (typeof v === 'object') {
          if (d > 6) return { type: 'object' }
          const properties = {}
          for (const [k, child] of Object.entries(v).slice(0, 100)) properties[k] = schema(child, d + 1)
          return { type: 'object', properties }
        }
        if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' }
        return { type: typeof v }
      }
      return schema(value, depth)
    }

    /** Generate a useful OpenAPI 3.0 draft from the captured samples. */
    function buildOpenApi(records) {
      const paths = {}
      for (const r of records) {
        let u
        try { u = new URL(r.url) } catch { continue }
        const path = u.pathname || '/'
        const method = String(r.method ?? 'GET').toLowerCase()
        const op = paths[path]?.[method] ?? {
          operationId: `${method}_${path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}`,
          summary: `${r.method} ${path}`,
          parameters: [],
          responses: {},
        }
        for (const key of u.searchParams.keys()) {
          if (!op.parameters.some((p) => p.name === key)) op.parameters.push({ name: key, in: 'query', required: false, schema: { type: 'string' } })
        }
        const reqType = String(headerValue(r.reqHeaders, 'content-type') ?? 'application/json').split(';')[0]
        if (typeof r.reqBody === 'string' && r.reqBody !== '' && !op.requestBody) {
          op.requestBody = { required: true, content: { [reqType || 'text/plain']: { schema: bodyJsonSchema(r.reqBody) ?? { type: 'string' }, example: r.reqBody } } }
        }
        const status = String(Number.isInteger(r.status) ? r.status : 200)
        if (op.responses[status] === undefined) {
          const resType = String(headerValue(r.resHeaders, 'content-type') ?? 'application/json').split(';')[0]
          op.responses[status] = { description: 'Captured response', content: typeof r.resBody === 'string' && r.resBody !== '' ? { [resType || 'text/plain']: { schema: bodyJsonSchema(r.resBody) ?? { type: 'string' }, example: r.resBody } } : undefined }
        }
        paths[path] ??= {}
        paths[path][method] = op
      }
      return { openapi: '3.0.3', info: { title: 'DSH captured API', version: new Date().toISOString().slice(0, 10) }, servers: [], paths }
    }

    function jsonDiff(before, after, path = '$', out = []) {
      if (out.length >= 100) return out
      if (before === after) return out
      if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
        out.push({ path, before, after })
        return out
      }
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const key of keys) jsonDiff(before[key], after[key], `${path}.${key}`, out)
      return out
    }

    function replayDiff(original, response) {
      if (original === null || typeof response?.body !== 'string') return []
      const changes = []
      if (Number.isInteger(original.status) && Number.isInteger(response.status) && original.status !== response.status) changes.push({ path: '$.status', before: original.status, after: response.status })
      try {
        const before = JSON.parse(original.resBody ?? '')
        const after = JSON.parse(response.body)
        return jsonDiff(before, after, '$.body', changes)
      } catch {
        if (original.resBody !== response.body) changes.push({ path: '$.body', before: original.resBody ?? '', after: response.body })
        return changes
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
      ;['', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'WS'].forEach((m) => {
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
      const freezeWrap = el('label', 'apv-autoscroll')
      freezeWrap.title = '冻结实时流：暂停自动刷新，方便查看/复制当前列表；取消勾选立即恢复（手动「刷新」仍可用）'
      const freezeCb = el('input', '')
      freezeCb.type = 'checkbox'
      freezeWrap.appendChild(freezeCb)
      freezeWrap.appendChild(document.createTextNode(' 冻结'))
      toolbar.appendChild(freezeWrap)
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
      const rulesBtn = el('button', 'apv-btn', '代理规则')
      rulesBtn.title = 'AutoResponder 规则引擎：按 URL/方法 mock 响应、伪造状态码、注入延迟、阻断请求（仅对本地代理流量生效）'
      toolbar.appendChild(rulesBtn)
      const bpBtn = el('button', 'apv-btn', '断点')
      bpBtn.title = '请求断点：命中的本地代理请求在转发前挂起，可改 方法/请求头/请求体 后放行或丢弃（Fiddler 式，仅请求阶段）'
      toolbar.appendChild(bpBtn)
      // 导出（P0-4）
      const exportSep = el('span', 'apv-sep', '|')
      toolbar.appendChild(exportSep)
      const exportSel = el('select', 'apv-select')
      ;['HAR', 'JSON', 'CSV', 'OpenAPI'].forEach((f) => {
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
      exportBtn.title = '导出 全部/当前筛选 的记录为 HAR / JSON / CSV / OpenAPI（可勾选脱敏）'
      toolbar.appendChild(exportBtn)
      const importBtn = el('button', 'apv-btn', '导入')
      importBtn.title = '导入 HAR 或之前导出的 JSON 记录，回灌进捕获库（可载入同事抓包/历史会话）'
      toolbar.appendChild(importBtn)
      const importFile = el('input', '')
      importFile.type = 'file'
      importFile.accept = '.har,.json,application/json'
      importFile.style.display = 'none'
      toolbar.appendChild(importFile)
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
      const minBytesIn = el('input', 'apv-fin apv-fin-dur')
      minBytesIn.type = 'number'
      minBytesIn.placeholder = '最小响应字节'
      fRow1.appendChild(minBytesIn)
      const maxBytesIn = el('input', 'apv-fin apv-fin-dur')
      maxBytesIn.type = 'number'
      maxBytesIn.placeholder = '最大响应字节'
      fRow1.appendChild(maxBytesIn)
      const fromIn = el('input', 'apv-fin apv-fin-dur')
      fromIn.type = 'datetime-local'
      fromIn.title = '开始时间'
      fRow1.appendChild(fromIn)
      const toIn = el('input', 'apv-fin apv-fin-dur')
      toIn.type = 'datetime-local'
      toIn.title = '结束时间'
      fRow1.appendChild(toIn)
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
      const sessionBtn = el('button', 'apv-btn', '会话视图')
      sessionBtn.title = '按 sessionId/traceId/调用方时间窗查看请求会话'
      fRow2.appendChild(sessionBtn)
      const timelineBtn = el('button', 'apv-btn', '时间分析')
      timelineBtn.title = '查看请求量、错误率、吞吐和 P50/P95/P99 趋势'
      fRow2.appendChild(timelineBtn)
      const waterfallBtn = el('button', 'apv-btn', '瀑布图')
      waterfallBtn.title = '请求级时间瀑布：每个请求一条横线，绿色段=等待响应(TTFB)，蓝色段=传输；点击查看详情'
      fRow2.appendChild(waterfallBtn)
      const repeatsBtn = el('button', 'apv-btn', '重复检测')
      repeatsBtn.title = '高频重复请求检测：同一接口在时间窗内反复调用（定时器风暴）'
      fRow2.appendChild(repeatsBtn)
      const baselineBtn = el('button', 'apv-btn', '基线管理')
      baselineBtn.title = '把当前筛选的接口契约存为基线，之后一键对比响应结构/状态码/字段变化'
      fRow2.appendChild(baselineBtn)
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
      const clearFilterBtn = el('button', 'apv-btn', '清空条件')
      clearFilterBtn.title = '清空当前筛选条件，不删除记录或已保存筛选'
      fRow2.appendChild(clearFilterBtn)
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
      const rotateBtn = el('button', 'apv-btn', '轮转日志')
      rotateBtn.title = '把当前跟踪/调用方日志改名归档（.bak）并按保留天数清理过期归档；捕获中会自动先停再启'
      fRow3.appendChild(rotateBtn)
      filterBar.appendChild(fRow3)
      const fRow4 = el('div', 'apv-frow')
      fRow4.appendChild(el('span', 'apv-note', '契约基线:'))
      const baselineSel = el('select', 'apv-select')
      baselineSel.title = '已保存的契约基线'
      fRow4.appendChild(baselineSel)
      const saveBaselineBtn = el('button', 'apv-btn', '保存基线')
      saveBaselineBtn.title = '把当前筛选命中的接口契约（状态码/Content-Type/响应字段结构）存为基线'
      fRow4.appendChild(saveBaselineBtn)
      const diffBaselineBtn = el('button', 'apv-btn', '对比')
      diffBaselineBtn.title = '用当前记录重新计算契约并与基线对比（新增/缺失端点、状态码与字段变化）'
      fRow4.appendChild(diffBaselineBtn)
      const delBaselineBtn = el('button', 'apv-btn apv-btn-danger', '删除基线')
      fRow4.appendChild(delBaselineBtn)
      filterBar.appendChild(fRow4)
      view.appendChild(filterBar)

      // ---- AutoResponder rules panel
      const rulesWrap = el('div', 'apv-agg')
      rulesWrap.hidden = true
      const rulesHelp = el('div', 'apv-note', '规则按顺序匹配第一条生效，仅对「本地代理」捕获的 HTTP(S) 流量起作用（含 HTTPS 解密流量，不含 WebSocket）。mock=直接回包不上行；延迟=转发前等待；阻断=断开连接；重写状态=正常转发但改响应状态码。')
      rulesHelp.style.padding = '0 0 8px'
      rulesWrap.appendChild(rulesHelp)
      const rulesForm = el('div', 'apv-rules-form')
      const ruleNameIn = el('input', 'apv-fin')
      ruleNameIn.placeholder = '规则名称'
      ruleNameIn.style.width = '110px'
      rulesForm.appendChild(ruleNameIn)
      const ruleMethodSel = el('select', 'apv-select')
      ;['', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].forEach((m) => {
        const opt = el('option', '', m === '' ? '方法:任意' : m)
        opt.value = m
        ruleMethodSel.appendChild(opt)
      })
      rulesForm.appendChild(ruleMethodSel)
      const ruleUrlIn = el('input', 'apv-fin')
      ruleUrlIn.placeholder = 'URL 匹配（子串/通配*/正则）'
      ruleUrlIn.style.width = '200px'
      rulesForm.appendChild(ruleUrlIn)
      const ruleTypeSel = el('select', 'apv-select')
      ;['contains', 'glob', 'regex'].forEach((t) => {
        const opt = el('option', '', t === 'contains' ? '包含' : t === 'glob' ? '通配' : '正则')
        opt.value = t
        ruleTypeSel.appendChild(opt)
      })
      rulesForm.appendChild(ruleTypeSel)
      const ruleActionSel = el('select', 'apv-select')
      ;['mock', 'delay', 'block', 'rewrite-status'].forEach((a) => {
        const opt = el('option', '', a === 'mock' ? 'mock 回包' : a === 'delay' ? '注入延迟' : a === 'block' ? '阻断' : '重写状态码')
        opt.value = a
        ruleActionSel.appendChild(opt)
      })
      rulesForm.appendChild(ruleActionSel)
      const ruleDelayIn = el('input', 'apv-fin apv-fin-dur')
      ruleDelayIn.type = 'number'
      ruleDelayIn.min = '0'
      ruleDelayIn.placeholder = '延迟ms'
      rulesForm.appendChild(ruleDelayIn)
      const ruleThrottleIn = el('input', 'apv-fin apv-fin-dur')
      ruleThrottleIn.type = 'number'
      ruleThrottleIn.min = '0'
      ruleThrottleIn.placeholder = '限速KB/s'
      ruleThrottleIn.title = '带宽限速（KB/s，0=不限）：对「延迟」类规则命中的响应按此速率下发，模拟弱网'
      rulesForm.appendChild(ruleThrottleIn)
      const ruleStatusIn = el('input', 'apv-fin apv-fin-dur')
      ruleStatusIn.type = 'number'
      ruleStatusIn.placeholder = '状态码'
      rulesForm.appendChild(ruleStatusIn)
      const ruleBodyIn = el('textarea', 'apv-fin apv-rule-body')
      ruleBodyIn.placeholder = 'mock 响应体（JSON/文本）'
      rulesForm.appendChild(ruleBodyIn)
      const ruleAddBtn = el('button', 'apv-btn', '添加规则')
      ruleAddBtn.title = '写入规则集（对正在运行的代理即时生效）'
      rulesForm.appendChild(ruleAddBtn)
      rulesWrap.appendChild(rulesForm)
      const rulesTable = el('table', 'apv-table apv-rules-table')
      const rulesHead = el('thead')
      const rulesHeadRow = el('tr')
      ;['启用', '名称', '匹配', '动作', '延迟', '状态/响应体', '命中', '操作'].forEach((h) => rulesHeadRow.appendChild(el('th', '', h)))
      rulesHead.appendChild(rulesHeadRow)
      rulesTable.appendChild(rulesHead)
      const rulesBodyEl = el('tbody')
      rulesTable.appendChild(rulesBodyEl)
      rulesWrap.appendChild(rulesTable)
      view.appendChild(rulesWrap)

      // ---- 请求断点面板
      const bpWrap = el('div', 'apv-agg')
      bpWrap.hidden = true
      bpWrap.appendChild(el('div', 'apv-note', '请求断点：启用后，命中（方法 / URL 子串 过滤）的「本地代理」请求会在转发前挂起，等你在下方改 方法/请求头/请求体 后「放行」，或「丢弃」。仅请求阶段；120s 未处理自动放行。'))
      const bpForm = el('div', 'apv-rules-form')
      const bpEnableWrap = el('label', 'apv-autoscroll')
      const bpEnableCb = el('input', '')
      bpEnableCb.type = 'checkbox'
      bpEnableWrap.appendChild(bpEnableCb)
      bpEnableWrap.appendChild(document.createTextNode(' 启用断点'))
      bpForm.appendChild(bpEnableWrap)
      const bpMethodSel = el('select', 'apv-select')
      ;[['', '全部方法'], ['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['DELETE', 'DELETE'], ['PATCH', 'PATCH']].forEach(([v, l]) => {
        const o = el('option', '', l)
        o.value = v
        bpMethodSel.appendChild(o)
      })
      bpForm.appendChild(bpMethodSel)
      const bpUrlIn = el('input', 'apv-fin')
      bpUrlIn.placeholder = 'URL 包含…（空=全部）'
      bpForm.appendChild(bpUrlIn)
      const bpSaveBtn = el('button', 'apv-btn', '应用配置')
      bpForm.appendChild(bpSaveBtn)
      bpWrap.appendChild(bpForm)
      const bpPausedEl = el('div', 'apv-bp-paused')
      bpWrap.appendChild(bpPausedEl)
      view.appendChild(bpWrap)

      // table
      const body = el('div', 'apv-body')
      const tableWrap = el('div', 'apv-table-wrap')
      const table = el('table', 'apv-table')
      const thead = el('thead')
      const headRow = el('tr')
      headRow.appendChild(el('th', '', '★'))
      ;['时间', '方法', '调用方', 'URL', '状态', '耗时', '来源', '备注'].forEach((h) => headRow.appendChild(el('th', '', h)))
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
      const sessionWrap = el('div', 'apv-agg')
      sessionWrap.hidden = true
      const sessionTable = el('table', 'apv-table')
      const sessionHead = el('thead')
      const sessionHeadRow = el('tr')
      ;['会话', '开始', '最近', '请求数', '错误', '响应字节', '方法', '域名'].forEach((h) => sessionHeadRow.appendChild(el('th', '', h)))
      sessionHead.appendChild(sessionHeadRow)
      sessionTable.appendChild(sessionHead)
      const sessionBodyEl = el('tbody')
      sessionTable.appendChild(sessionBodyEl)
      sessionWrap.appendChild(sessionTable)
      body.appendChild(sessionWrap)
      const timelineWrap = el('div', 'apv-agg')
      timelineWrap.hidden = true
      const timelineSummary = el('div', 'apv-timeline-summary')
      const timelineTitle = el('span', 'apv-timeline-title', '时间分桶明细')
      const timelineHelp = el('span', 'apv-timeline-help', '每一行统计该时间段内符合当前筛选条件的全部接口，不受列表分页影响。P50 是典型耗时，P95/P99 用来观察慢请求尾部。')
      timelineSummary.appendChild(timelineTitle)
      timelineSummary.appendChild(timelineHelp)
      timelineWrap.appendChild(timelineSummary)
      const timelineTable = el('table', 'apv-table apv-timeline-table')
      const timelineHead = el('thead')
      const timelineHeadRow = el('tr')
      ;[
        ['时间范围', '该行覆盖的完整时间段'],
        ['请求数', '该时间段内接口总数'],
        ['错误数', 'HTTP 400 及以上的请求数'],
        ['错误率', '错误数 ÷ 请求数'],
        ['响应总量', '所有响应 body 的字节数'],
        ['平均耗时', '该时间段请求耗时平均值'],
        ['P50 典型', '50% 请求不超过此耗时'],
        ['P95 较慢', '95% 请求不超过此耗时'],
        ['P99 极慢', '99% 请求不超过此耗时'],
      ].forEach(([label, title]) => {
        const th = el('th', '', label)
        th.title = title
        timelineHeadRow.appendChild(th)
      })
      timelineHead.appendChild(timelineHeadRow)
      timelineTable.appendChild(timelineHead)
      const timelineBodyEl = el('tbody')
      timelineTable.appendChild(timelineBodyEl)
      timelineWrap.appendChild(timelineTable)
      body.appendChild(timelineWrap)
      // ---- waterfall view (request-level timeline)
      const waterfallWrap = el('div', 'apv-agg')
      waterfallWrap.hidden = true
      const wfLegend = el('div', 'apv-wf-legend')
      wfLegend.appendChild(el('span', '', '横条位置=开始时间，长度=总耗时；'))
      wfLegend.appendChild(el('span', '', '分段: '))
      const leg1 = el('span', '')
      leg1.appendChild(el('i', 'apv-wf-total'))
      leg1.appendChild(document.createTextNode('传输/处理'))
      wfLegend.appendChild(leg1)
      const leg2 = el('span', '')
      leg2.appendChild(el('i', 'apv-wf-wait'))
      leg2.appendChild(document.createTextNode('等待响应(TTFB)'))
      wfLegend.appendChild(leg2)
       wfLegend.appendChild(el('span', 'apv-note', '代理记录的连接/TLS 分段见横条文字和详情；实时日志未提供 DNS 级耗时'))
      waterfallWrap.appendChild(wfLegend)
      const waterfallList = el('div', 'apv-wf')
      waterfallWrap.appendChild(waterfallList)
      body.appendChild(waterfallWrap)
      // ---- repeats view (timer-storm detection)
      const repeatsWrap = el('div', 'apv-agg')
      repeatsWrap.hidden = true
      const repeatsSummary = el('div', 'apv-timeline-summary')
      const repeatsTitle = el('span', 'apv-timeline-title', '高频重复请求检测')
      const repeatsHelp = el('span', 'apv-timeline-help', '同一「方法+路径」在 10 秒窗口内出现 ≥5 次即上榜（峰值速率=窗口内次数折算每分钟）。定时器风暴、循环拉取的典型特征。点击行过滤出该接口的全部记录。')
      repeatsSummary.appendChild(repeatsTitle)
      repeatsSummary.appendChild(repeatsHelp)
      repeatsWrap.appendChild(repeatsSummary)
      const repeatsTable = el('table', 'apv-table')
      const repeatsHead = el('thead')
      const repeatsHeadRow = el('tr')
      ;['接口', '总次数', '窗口内峰值', '峰值速率/分', '调用方', '最近状态', '首次', '最近'].forEach((h) => repeatsHeadRow.appendChild(el('th', '', h)))
      repeatsHead.appendChild(repeatsHeadRow)
      repeatsTable.appendChild(repeatsHead)
      const repeatsBodyEl = el('tbody')
      repeatsTable.appendChild(repeatsBodyEl)
      repeatsWrap.appendChild(repeatsTable)
      body.appendChild(repeatsWrap)
      // ---- baseline view (contract drift)
      const baselineWrap = el('div', 'apv-agg')
      baselineWrap.hidden = true
      const baselineSummary = el('div', 'apv-timeline-summary')
      const baselineTitle = el('span', 'apv-timeline-title', '契约基线对比')
      const baselineHelp = el('span', 'apv-timeline-help', '')
      baselineSummary.appendChild(baselineTitle)
      baselineSummary.appendChild(baselineHelp)
      baselineWrap.appendChild(baselineSummary)
      const baselineBodyEl = el('div')
      baselineWrap.appendChild(baselineBodyEl)
      body.appendChild(baselineWrap)

      // detail drawer
      const detail = el('div', 'apv-detail')
      detail.hidden = true
      const detailResize = el('div', 'apv-detail-resize')
      detailResize.role = 'separator'
      detailResize.tabIndex = 0
      detailResize.title = '拖动调整详情区高度'
      detailResize.setAttribute('aria-label', '调整详情区高度')
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
      const setDiffABtn = el('button', 'apv-btn', '设为对比A')
      setDiffABtn.title = '把当前记录设为对比基准 A（再选另一条点「与A对比」并排 diff 请求/响应体）'
      const diffWithABtn = el('button', 'apv-btn', '与A对比')
      diffWithABtn.title = '把当前记录作为 B，与基准 A 并排 diff 请求体/响应体'
      diffWithABtn.disabled = true
      const locateSrcBtn = el('button', 'apv-btn', '定位源码')
      locateSrcBtn.title = '按调用方归因（ViewModel/API 方法）在客户端源码（环境变量 DSH_API_SRC_ROOT 指向的根目录）中查找定义，可一键在 VS Code 打开'
      locateSrcBtn.disabled = true
      const detailClose = el('button', 'apv-btn', '关闭')
      detailHead.appendChild(detailTitle)
      detailHead.appendChild(copyUrlBtn)
      detailHead.appendChild(copyAsSel)
      detailHead.appendChild(copyAsBtn)
      detailHead.appendChild(replayBtn)
      detailHead.appendChild(openPmBtn)
      detailHead.appendChild(setDiffABtn)
      detailHead.appendChild(diffWithABtn)
      detailHead.appendChild(locateSrcBtn)
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
      detail.appendChild(detailResize)
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
      let renderedRecords = [] // 当前表格实际渲染的记录（供上下键选行）
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
          localStorage.setItem(PREFS_KEY, JSON.stringify({ autoScroll: state.autoScroll, autoCapture: autoCapCb.checked, logPath: logPathIn.value.trim(), savedFilters: state.savedFilters, detailHeight: state.detailHeight }))
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
        minBytes: '',
        maxBytes: '',
        fromTs: '',
        toTs: '',
        sessionId: '',
        detailHeight: Number.isFinite(Number(initialPrefs.detailHeight)) ? Number(initialPrefs.detailHeight) : null,
        errorsOnly: false,
        noNoise: false,
        regex: false,
        bodyQ: '',
        aggView: false,
        sessionView: false,
        timelineView: false,
        waterfallView: false,
        repeatsView: false,
        baselineView: false,
        baselineName: '',
        baselineReport: null,
        savedFilters: Array.isArray(initialPrefs.savedFilters) ? initialPrefs.savedFilters : [],
        timer: null,
        lastRenderKey: '',
        capture: { running: false, status: null, staleCount: 0, prevLogSize: null },
        proxy: { running: false, status: null },
        autoScroll: initialPrefs.autoScroll !== false,
        frozen: false,
      }

      const setDetailHeight = (height, persist = true) => {
        const bodyRect = body.getBoundingClientRect()
        const min = 180
        const max = Math.max(min, bodyRect.height - 140)
        const next = Math.round(Math.max(min, Math.min(max, Number(height))))
        if (!Number.isFinite(next)) return
        state.detailHeight = next
        detail.style.setProperty('--apv-detail-height', `${next}px`)
        if (persist) savePrefs()
      }

      if (state.detailHeight !== null) detail.style.setProperty('--apv-detail-height', `${state.detailHeight}px`)

      let resizeDrag = null
      detailResize.addEventListener('pointerdown', (event) => {
        if (detail.hidden) return
        event.preventDefault()
        detailResize.setPointerCapture?.(event.pointerId)
        resizeDrag = { startY: event.clientY, startHeight: detail.getBoundingClientRect().height }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'ns-resize'
      })
      detailResize.addEventListener('pointermove', (event) => {
        if (resizeDrag === null) return
        setDetailHeight(resizeDrag.startHeight + resizeDrag.startY - event.clientY, false)
      })
      const finishResize = () => {
        if (resizeDrag === null) return
        resizeDrag = null
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        savePrefs()
      }
      detailResize.addEventListener('pointerup', finishResize)
      detailResize.addEventListener('pointercancel', finishResize)
      detailResize.addEventListener('keydown', (event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const current = detail.getBoundingClientRect().height
        if (event.key === 'ArrowUp') setDetailHeight(current + 24)
        else if (event.key === 'ArrowDown') setDetailHeight(current - 24)
        else if (event.key === 'Home') setDetailHeight(180)
        else setDetailHeight(body.getBoundingClientRect().height - 140)
      })

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

      /** 源码定位结果：文件命中列表 + 打开按钮。 */
      function renderSourceHits(result, caller) {
        const sec = el('div', 'apv-sec')
        const secTitle = el('div', 'apv-sec-title')
        secTitle.appendChild(el('span', 'apv-t', '定位源码'))
        sec.appendChild(secTitle)
        const files = result?.files ?? []
        if (files.length === 0) {
          sec.appendChild(el('div', 'apv-note', `在 ${(result?.roots ?? []).join('; ') || '源码根'} 下未找到 ${caller.viewModel || caller.apiMethod || ''} 的定义（已扫 ${result?.searched ?? 0} 个文件）`))
          return sec
        }
        for (const hit of files) {
          const row = el('div', 'apv-src-hit')
          const pathEl = el('span', 'apv-src-path', `${hit.path}${hit.matches.length > 0 ? ' :' + hit.matches[0].line : ''}`)
          pathEl.title = hit.path + hit.matches.map((m) => `\nL${m.line} ${m.what}`).join('')
          row.appendChild(pathEl)
          const openBtn = el('button', 'apv-btn', '打开')
          openBtn.style.padding = '2px 8px'
          openBtn.style.fontSize = '11px'
          openBtn.title = '在 VS Code 打开（带行号），失败则用资源管理器定位'
          openBtn.addEventListener('click', () => {
            openBtn.disabled = true
            apiFetch('/source/open', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: hit.path, line: hit.matches.length > 0 ? hit.matches[0].line : 1 }),
            })
              .catch((error) => console.error('[dsh-api-visualizer] source open failed:', error))
              .finally(() => {
                openBtn.disabled = false
              })
          })
          row.appendChild(openBtn)
          sec.appendChild(row)
        }
        return sec
      }

      let replayWrap = null

      // -------- 两条记录并排 body diff（设 A → 选 B → 与A对比）
      let diffBaseRecord = null
      const shortUrlText = (u) => { try { return new URL(u).pathname } catch { return String(u ?? '').slice(0, 48) } }
      const updateDiffButtons = () => {
        setDiffABtn.textContent = diffBaseRecord !== null ? '对比A ✓' : '设为对比A'
        diffWithABtn.disabled = diffBaseRecord === null || currentFull === null || (diffBaseRecord !== null && currentFull !== null && diffBaseRecord.id === currentFull.id)
      }
      const bodyTextOf = (rec, which) => {
        const raw = which === 'req' ? rec.reqBody : rec.resBody
        if (typeof raw !== 'string' || raw === '') return ''
        return formatBody(raw) ?? raw
      }
      // 行级 LCS diff（并排对齐）；大文本截断到前 1500 行，避免 O(n*m) 爆炸
      const lineDiffPairs = (aText, bText) => {
        const CAP = 1500
        let a = String(aText ?? '').split('\n')
        let b = String(bText ?? '').split('\n')
        const truncated = a.length > CAP || b.length > CAP
        if (a.length > CAP) a = a.slice(0, CAP)
        if (b.length > CAP) b = b.slice(0, CAP)
        const n = a.length, m = b.length
        const dp = []
        for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1))
        for (let i = n - 1; i >= 0; i--) {
          for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
          }
        }
        const pairs = []
        let i = 0, j = 0
        while (i < n && j < m) {
          if (a[i] === b[j]) { pairs.push({ a: a[i], b: b[j], type: 'same' }); i++; j++ }
          else if (dp[i + 1][j] >= dp[i][j + 1]) { pairs.push({ a: a[i], b: null, type: 'del' }); i++ }
          else { pairs.push({ a: null, b: b[j], type: 'ins' }); j++ }
        }
        while (i < n) { pairs.push({ a: a[i], b: null, type: 'del' }); i++ }
        while (j < m) { pairs.push({ a: null, b: b[j], type: 'ins' }); j++ }
        return { pairs, truncated }
      }
      const renderDiffPair = (title, aText, bText) => {
        const sec = el('div', 'apv-sec')
        sec.appendChild(el('div', 'apv-sec-title', title))
        if (aText === '' && bText === '') { sec.appendChild(el('div', 'apv-note', '两侧均无内容')); return sec }
        const { pairs, truncated } = lineDiffPairs(aText, bText)
        const changed = pairs.filter((p) => p.type !== 'same').length
        if (changed === 0) { sec.appendChild(el('div', 'apv-note', '无差异')); return sec }
        const table = el('table', 'apv-difftable')
        for (const p of pairs) {
          const tr = el('tr')
          const la = el('td', 'apv-diff-a' + (p.type === 'del' ? ' apv-diff-del' : p.type === 'ins' ? ' apv-diff-blank' : ''))
          la.textContent = p.a ?? ''
          const lb = el('td', 'apv-diff-b' + (p.type === 'ins' ? ' apv-diff-ins' : p.type === 'del' ? ' apv-diff-blank' : ''))
          lb.textContent = p.b ?? ''
          tr.appendChild(la)
          tr.appendChild(lb)
          table.appendChild(tr)
        }
        sec.appendChild(table)
        if (truncated) sec.appendChild(el('div', 'apv-note', '（内容过长，diff 已截断到前 1500 行）'))
        return sec
      }
      const renderRecordDiff = (a, b) => {
        detailBody.querySelectorAll('.apv-diffwrap').forEach((n) => n.remove())
        const wrap = el('div', 'apv-sec apv-diffwrap')
        wrap.appendChild(el('div', 'apv-sec-title', `对比  A: ${a.method} ${shortUrlText(a.url)}   ⇄   B: ${b.method} ${shortUrlText(b.url)}`))
        wrap.appendChild(renderDiffPair('请求体 diff（左 A · 右 B）', bodyTextOf(a, 'req'), bodyTextOf(b, 'req')))
        wrap.appendChild(renderDiffPair('响应体 diff（左 A · 右 B）', bodyTextOf(a, 'res'), bodyTextOf(b, 'res')))
        detailBody.insertBefore(wrap, detailBody.firstChild)
      }
      setDiffABtn.addEventListener('click', () => { if (currentFull !== null) { diffBaseRecord = currentFull; updateDiffButtons() } })
      diffWithABtn.addEventListener('click', () => {
        if (diffBaseRecord === null || currentFull === null || diffBaseRecord.id === currentFull.id) return
        renderRecordDiff(diffBaseRecord, currentFull)
      })

      function renderDetail(full) {
        currentFull = full
        updateDiffButtons()
        selectedUrl = full.url
        detailTitle.textContent = `${full.method} ${full.url}`
        locateSrcBtn.disabled = full.caller === undefined || full.caller === null
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
        if (full.caller !== undefined && full.caller !== null) {
          const c = full.caller
          const lines = []
          if (c.viewModel) lines.push('ViewModel : ' + c.viewModel)
          if (c.view) lines.push('View(约定): ' + c.view)
          if (c.apiMethod) lines.push('Api       : ' + c.apiMethod)
          if (c.trigger) lines.push('触发方法  : ' + c.trigger)
          const chain = normalizeStack(c.stack).slice().reverse()
          if (chain.length > 0) {
            lines.push('调用链(入口→接口):')
            chain.forEach((f, i) => lines.push('    ' + String(i + 1).padStart(2, ' ') + '. ' + f))
          }
          if (lines.length > 0) detailBody.appendChild(makePreSection('调用方', lines.join('\n')))
        }
        if (full.reqHeaders !== undefined) detailBody.appendChild(makePreSection('请求头', JSON.stringify(full.reqHeaders, null, 2)))
        if (typeof full.reqBody === 'string' && full.reqBody !== '') {
          bodySections.push(makeBodySection('请求体', full.reqBody, headerValue(full.reqHeaders, 'content-type'), detailBody))
        }
        if (full.resHeaders !== undefined) detailBody.appendChild(makePreSection('响应头', JSON.stringify(full.resHeaders, null, 2)))
        if (typeof full.resBody === 'string' && full.resBody !== '') {
          bodySections.push(makeBodySection('响应体', full.resBody, headerValue(full.resHeaders, 'content-type'), detailBody))
        }
        noteInput.value = full.note ?? ''
        tagInput.value = full.tag ?? ''
        const streamMeta = {
          complete: full.complete,
          streaming: full.streaming,
          firstByteMs: full.firstByteMs,
          ttfbMs: full.ttfbMs,
          connectMs: full.connectMs,
          tlsMs: full.tlsMs,
          bytesReq: full.bytesReq,
          bytesRes: full.bytesRes,
          chunkCount: full.chunkCount,
          sessionId: full.sessionId,
          traceId: full.traceId,
          parentId: full.parentId,
          ruleId: full.ruleId,
        }
        if (Object.values(streamMeta).some((v) => v !== undefined)) detailBody.insertBefore(makePreSection('流式/关联元数据', JSON.stringify(streamMeta, null, 2)), detailBody.firstChild)
        if (full.ws !== undefined && full.ws !== null) {
          const ws = {
            closeCode: full.ws.closeCode,
            closeReason: full.ws.closeReason,
            frameCount: full.ws.frameCount,
            msgCount: full.ws.msgCount,
            frames: full.ws.frames,
          }
          detailBody.insertBefore(makePreSection('WebSocket 帧记录', JSON.stringify(ws, null, 2)), detailBody.firstChild)
        }
      }

      function renderReplayResult(response, original) {
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
        const diffs = replayDiff(original, response)
        if (diffs.length > 0) {
          const diffPre = highlightedPre(JSON.stringify(diffs, null, 2), '')
          replayWrap.appendChild(el('div', 'apv-sec-title', `响应差异 (${diffs.length})`))
          replayWrap.appendChild(diffPre)
        } else if (response?.ok && original !== null) {
          replayWrap.appendChild(el('div', 'apv-note', '响应 body 未发现结构差异'))
        }
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
          .then((data) => renderReplayResult(data.response, currentFull))
          .catch((error) => renderReplayResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, currentFull))
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
            body: JSON.stringify({ flag: !isFlagged(rec) }),
          })
          rec.flag = isFlagged(updated)
          starBtn.textContent = rec.flag ? '★' : '☆'
          starBtn.dataset.on = rec.flag ? '1' : '0'
          if (currentFull !== null && currentFull.id === rec.id) currentFull.flag = rec.flag
        } catch (error) {
          console.error('[dsh-api-visualizer] flag failed:', error)
        }
      }

      const renderStats = (s) => {
        stats.textContent = ''
        stats.appendChild(document.createTextNode(`共 ${s.total} 条`))
        if (s.lastTs !== null) stats.appendChild(document.createTextNode(` · 最新 ${fmtTime(s.lastTs)}`))
        for (const [m, n] of Object.entries(s.byMethod)) {
          stats.appendChild(document.createTextNode(' · '))
          const chip = el('span', 'apv-statchip' + (state.method === m ? ' apv-statchip-on' : ''), `${m} ${n}`)
          chip.title = `点击按方法 ${m} 筛选（再点清除）`
          chip.addEventListener('click', () => {
            const next = state.method === m ? '' : m
            state.method = next
            methodSel.value = next
            refresh()
          })
          stats.appendChild(chip)
        }
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
            `代理 ● 127.0.0.1:${cap.port} · 上游 ${cap.upstream ?? '直连'} · 已抓 ${cap.counters?.requests ?? 0} · HTTPS解密 ${cap.counters?.mitm ?? 0} · WS ${cap.counters?.ws ?? 0} · 规则 ${cap.rules?.enabled ?? 0}/${cap.rules?.total ?? 0}`
          proxyChip.className = 'apv-stats apv-live-on'
          proxyBtn.textContent = '停止代理'
          proxyBtn.classList.add('apv-capture-on')
        } else {
          proxyChip.textContent = cap === null
            ? '代理引擎不可用'
            : `代理 ○ 未启动${cap.error ? ` · ${cap.error}` : (cap.caReady ? ' · 证书就绪' : '')}`
          proxyChip.className = 'apv-stats'
          proxyBtn.textContent = '启动代理'
          proxyBtn.classList.remove('apv-capture-on')
        }
        const sysActive = cap !== null && cap.systemProxyActive === true
        sysProxyBtn.textContent = sysActive ? '取消系统代理' : '设为系统代理'
        sysProxyBtn.classList.toggle('apv-capture-on', sysActive)
      }

      // 行内容签名：涵盖该行展示的全部字段；两次渲染签名一致 = 行可原样复用（无需重建）。
      const rowSig = (r) => [
        r.id, r.ts, r.method, r.status, r.durationMs, r.source, r.note, isFlagged(r) ? 1 : 0, r.url,
        r.caller ? `${formatCallChain(r.caller.stack)}|${r.caller.viewModel ?? ''}|${r.caller.apiMethod ?? ''}` : '',
      ].join('')
      let renderedSig = [] // 与 tbody 中数据行一一对应的签名（供增量对齐）

      /** 建一条记录行（含星标/点击/详情打开）。 */
      const makeRow = (r) => {
        const tr = el('tr')
        if (r.id === selectedId) tr.classList.add('apv-selected')
        const starTd = el('td')
        const starred = isFlagged(r)
        const starBtn = el('button', 'apv-star', starred ? '★' : '☆')
        starBtn.dataset.on = starred ? '1' : '0'
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
        tr.appendChild(callerCell(r.caller))
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
        return tr
      }

      const renderRows = (records) => {
        renderedRecords = records
        if (records.length === 0) {
          tbody.textContent = ''
          renderedSig = []
          const row = el('tr')
          const cell = el('td', 'apv-empty', '暂无记录 — 点击「开始实时捕获」，客户端流量会像 Fiddler 一样实时流进来；也可用 api_capture_append 手动上报')
          cell.colSpan = 9
          row.appendChild(cell)
          tbody.appendChild(row)
          return
        }
        const newSig = records.map(rowSig)
        // 增量渲染：实时新记录出现在列表头部（最新在前），旧行整体下移、超出 LIMIT 的尾部被裁掉。
        // 若旧渲染首行仍在新列表中且其后与旧渲染逐项一致 → 只在顶部插入新增行、删掉尾部裁掉的行，
        // 避免每秒整表（约 300 行）重建。任何不一致（含内容变化）都回退整表重建，保证正确。
        let incremental = false
        if (renderedSig.length > 0 && tbody.querySelector('.apv-empty') === null && tbody.childNodes.length === renderedSig.length) {
          const p = newSig.indexOf(renderedSig[0])
          const shared = p >= 0 ? newSig.length - p : -1
          if (p >= 0 && shared <= renderedSig.length) {
            let ok = true
            for (let i = 0; i < shared; i++) { if (newSig[p + i] !== renderedSig[i]) { ok = false; break } }
            if (ok) {
              for (let i = renderedSig.length - 1; i >= shared; i--) tbody.removeChild(tbody.childNodes[i]) // 裁掉尾部
              for (let i = p - 1; i >= 0; i--) tbody.insertBefore(makeRow(records[i]), tbody.firstChild) // 顶部插新增
              incremental = true
            }
          }
        }
        if (!incremental) {
          tbody.textContent = ''
          for (const r of records) tbody.appendChild(makeRow(r))
        }
        renderedSig = newSig
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
             q.value = e.path
             state.q = e.path
             setView('table')
           })
          aggBodyEl.appendChild(tr)
        }
      }

      const VIEW_MODES = ['agg', 'session', 'timeline', 'waterfall', 'repeats', 'baseline']
      const viewWraps = { agg: aggWrap, session: sessionWrap, timeline: timelineWrap, waterfall: waterfallWrap, repeats: repeatsWrap, baseline: baselineWrap }
      const viewButtons = { agg: aggBtn, session: sessionBtn, timeline: timelineBtn, waterfall: waterfallBtn, repeats: repeatsBtn, baseline: baselineBtn }
      const activeView = () => VIEW_MODES.find((m) => state[m + 'View'] === true) ?? null
      const setView = (mode) => {
        for (const m of VIEW_MODES) state[m + 'View'] = m === mode
        const active = activeView()
        for (const [m, wrap] of Object.entries(viewWraps)) wrap.hidden = m !== active
        for (const [m, btn] of Object.entries(viewButtons)) btn.classList.toggle('apv-btn-on', m === active)
        tableWrap.hidden = active !== null
        if (active !== null) closeDetail()
        refresh()
      }

      const renderSessions = (data) => {
        sessionBodyEl.textContent = ''
        for (const s of data?.items ?? []) {
          const tr = el('tr')
          tr.appendChild(el('td', '', `${s.explicit ? '◆ ' : ''}${s.sessionId}`))
          tr.appendChild(el('td', '', fmtTime(s.firstTs)))
          tr.appendChild(el('td', '', fmtTime(s.lastTs)))
          tr.appendChild(el('td', '', String(s.count)))
          const err = el('td', '', String(s.errors))
          if (s.errors > 0) err.style.color = '#f87171'
          tr.appendChild(err)
          tr.appendChild(el('td', '', String(s.bytesRes ?? 0)))
          tr.appendChild(el('td', '', Object.entries(s.methods ?? {}).map(([k, v]) => `${k}:${v}`).join(' ')))
          tr.appendChild(el('td', '', Object.keys(s.hosts ?? {}).join(', ')))
          tr.title = (s.records ?? []).map((r) => `${r.method} ${r.status ?? '-'} ${r.url}`).join('\n')
          tr.addEventListener('click', () => {
            state.sessionId = s.sessionId
            q.value = ''
            state.q = ''
            setView('table')
          })
          sessionBodyEl.appendChild(tr)
        }
        if ((data?.items ?? []).length === 0) sessionBodyEl.appendChild(el('tr')).appendChild(el('td', 'apv-empty', '暂无会话'))
      }

      const renderTimeline = (data) => {
        const items = data?.items ?? []
        const totalRequests = items.reduce((sum, bucket) => sum + (Number(bucket.count) || 0), 0)
        const totalErrors = items.reduce((sum, bucket) => sum + (Number(bucket.errors) || 0), 0)
        const totalBytes = items.reduce((sum, bucket) => sum + (Number(bucket.bytesRes) || 0), 0)
        timelineTitle.textContent = items.length === 0
          ? '时间分桶明细 · 暂无数据'
          : `时间分桶明细 · 每 ${fmtBucket(data.bucketMs)} · ${items.length} 个时间段 · ${totalRequests} 个请求`
        timelineHelp.textContent = items.length === 0
          ? '当前筛选条件和时间范围内没有接口记录。'
          : `合计 ${totalRequests} 个请求，${totalErrors} 个错误，响应 ${fmtBytes(totalBytes)}。每一行统计该时间段内符合当前筛选条件的全部接口，不受列表分页影响。P50 是典型耗时，P95/P99 用来观察慢请求尾部。`
        timelineBodyEl.textContent = ''
        for (const bucket of items) {
          const row = el('tr')
          const range = el('td', 'apv-timeline-range', `${fmtTime(bucket.start)} - ${fmtTime(bucket.end)}`)
          range.title = `${new Date(bucket.start).toLocaleString()} 至 ${new Date(bucket.end).toLocaleString()}`
          row.appendChild(range)
          row.appendChild(el('td', '', String(bucket.count ?? 0)))
          const errorCell = el('td', bucket.errors > 0 ? 'apv-timeline-error' : 'apv-timeline-muted', String(bucket.errors ?? 0))
          row.appendChild(errorCell)
          const rateCell = el('td', bucket.errors > 0 ? 'apv-timeline-error' : 'apv-timeline-muted', `${((Number(bucket.errorRate) || 0) * 100).toFixed(1)}%`)
          row.appendChild(rateCell)
          const bytesCell = el('td', '', fmtBytes(Number(bucket.bytesRes) || 0))
          bytesCell.title = `${Number(bucket.bytesRes) || 0} 字节`
          row.appendChild(bytesCell)
          row.appendChild(el('td', '', fmtDur(bucket.avgMs)))
          row.appendChild(el('td', 'apv-timeline-muted', fmtDur(bucket.p50Ms)))
          row.appendChild(el('td', 'apv-timeline-tail', fmtDur(bucket.p95Ms)))
          row.appendChild(el('td', 'apv-timeline-tail', fmtDur(bucket.p99Ms)))
          timelineBodyEl.appendChild(row)
        }
        if (items.length === 0) {
          const row = el('tr')
          const cell = el('td', 'apv-empty', '暂无时间分析数据')
          cell.colSpan = 9
          row.appendChild(cell)
          timelineBodyEl.appendChild(row)
        }
      }

      /** Waterfall: one bar per request on a shared time axis; green=TTFB, blue=transfer. */
      const renderWaterfall = (records) => {
        waterfallList.textContent = ''
        if (records.length === 0) {
          waterfallList.appendChild(el('div', 'apv-empty', '暂无数据 — 当前筛选条件下没有请求（实时捕获的请求自带 TTFB 分段）'))
          return
        }
        const times = records.map((r) => Number(r.ts)).filter(Number.isFinite)
        const ends = records.map((r) => Number(r.ts) + (Number(r.durationMs) || 0)).filter(Number.isFinite)
        if (times.length === 0) return
        const t0 = Math.min(...times)
        const t1 = Math.max(...ends)
        const span = Math.max(t1 - t0, 1)
        const pct = (v) => ((v / span) * 100).toFixed(3) + '%'
        for (const r of records) {
          const row = el('div', 'apv-wf-row')
          const c = r.caller ?? {}
          const who = c.viewModel || c.view || ''
           const connectMs = Number(r.connectMs)
           const tlsMs = Number(r.tlsMs)
           const ttfb = Number(r.firstByteMs ?? r.ttfbMs)
           const phaseText = [
             Number.isFinite(connectMs) ? `连接 ${fmtDur(connectMs)}` : '',
             Number.isFinite(tlsMs) ? `TLS ${fmtDur(tlsMs)}` : '',
             Number.isFinite(ttfb) ? `TTFB ${fmtDur(ttfb)}` : '',
           ].filter(Boolean).join(' · ')
           const meta = el('div', 'apv-wf-meta', `${fmtTime(r.ts)} · ${r.method} ${statusBadge(r.status).textContent} · ${fmtDur(r.durationMs)}${phaseText !== '' ? ' · ' + phaseText : ''}${who !== '' ? ' · ' + who : ''}`)
          row.appendChild(meta)
          const track = el('div', 'apv-wf-track')
          const bar = el('div', 'apv-wf-bar')
          bar.style.left = pct(Number(r.ts) - t0)
          const dur = Math.max(Number(r.durationMs) || 0, 1)
          bar.style.width = pct(dur)
           if (Number.isFinite(ttfb) && ttfb > 0 && ttfb < dur) {
            const seg = el('div', 'apv-wf-ttfb')
            seg.style.width = ((ttfb / dur) * 100).toFixed(1) + '%'
            bar.appendChild(seg)
          }
           bar.title = `${r.method} ${r.url}\n开始: ${fmtTime(r.ts)}\n连接: ${fmtDur(connectMs)}\nTLS: ${fmtDur(tlsMs)}\n等待响应(TTFB): ${fmtDur(ttfb)}\n总耗时: ${fmtDur(r.durationMs)}\n${who !== '' ? '调用方: ' + who : ''}`
          bar.addEventListener('click', () => {
            selectedId = r.id
            apiFetch(`/records/${encodeURIComponent(r.id)}`).then((full) => {
              renderDetail(full)
              detail.hidden = false
            }).catch((error) => { console.error('[dsh-api-visualizer] detail failed:', error) })
          })
          track.appendChild(bar)
          row.appendChild(track)
          waterfallList.appendChild(row)
        }
      }

      /** Repeats: burst detection table. */
      const renderRepeats = (data) => {
        repeatsBodyEl.textContent = ''
        const items = data?.items ?? []
        repeatsTitle.textContent = items.length === 0
          ? '高频重复请求检测 · 未发现'
          : `高频重复请求检测 · ${items.length} 个接口存在 ${data.windowMs}ms 窗口内 ≥${data.minCount} 次的突发`
        if (items.length === 0) {
          const row = el('tr')
          const cell = el('td', 'apv-empty', '当前筛选范围内没有高频重复请求')
          cell.colSpan = 8
          row.appendChild(cell)
          repeatsBodyEl.appendChild(row)
          return
        }
        for (const e of items) {
          const tr = el('tr')
          const epTd = el('td')
          epTd.appendChild(methodBadge(e.method))
          epTd.appendChild(document.createTextNode(' ' + e.path))
          epTd.title = e.lastUrl ?? ''
          tr.appendChild(epTd)
          tr.appendChild(el('td', '', String(e.count)))
          const peak = el('td', '', String(e.maxInWindow))
          peak.style.color = '#fbbf24'
          tr.appendChild(peak)
          tr.appendChild(el('td', '', e.peakRatePerMin === null ? '-' : `≈${e.peakRatePerMin}/分`))
          tr.appendChild(el('td', 'apv-caller', e.caller ?? ''))
          tr.appendChild(el('td', '', e.lastStatus === null || e.lastStatus === undefined ? '-' : String(e.lastStatus)))
          tr.appendChild(el('td', '', fmtTime(e.firstTs)))
          tr.appendChild(el('td', '', fmtTime(e.lastTs)))
          tr.addEventListener('click', () => {
            q.value = e.path
            state.q = e.path
            setView('table')
          })
          repeatsBodyEl.appendChild(tr)
        }
      }

      const renderBaselineSel = (items) => {
        const current = baselineSel.value
        baselineSel.textContent = ''
        const all = el('option', '', items.length === 0 ? '(无基线)' : '选择基线…')
        all.value = ''
        baselineSel.appendChild(all)
        for (const b of items) {
          const opt = el('option', '', `${b.name} (${b.endpoints}端点 · ${b.records}条)`)
          opt.value = b.name
          baselineSel.appendChild(opt)
        }
        baselineSel.value = items.some((b) => b.name === current) ? current : ''
      }

      const renderBaselineReport = (report) => {
        const wrap = el('div')
        const head = el('div', 'apv-note', `基线「${report.name}」· 保存于 ${report.savedAt ? fmtTime(report.savedAt) : '-'} · 基线 ${report.baselineRecords} 条 / 当前 ${report.currentRecords} 条 · 端点 ${report.baselineEndpoints} → ${report.currentEndpoints}`)
        head.style.padding = '6px 0'
        wrap.appendChild(head)
        if ((report.changes ?? []).length === 0) {
          wrap.appendChild(el('div', 'apv-note', '✔ 契约无变化：状态码、Content-Type、响应字段结构一致'))
          return wrap
        }
        const table = el('table', 'apv-table')
        const thead = el('thead')
        const headRow = el('tr')
        ;['端点', '变化', '详情'].forEach((h) => headRow.appendChild(el('th', '', h)))
        thead.appendChild(headRow)
        table.appendChild(thead)
        const tbody = el('tbody')
        for (const ch of report.changes) {
          const tr = el('tr')
          tr.appendChild(el('td', '', ch.endpoint))
          const kindTd = el('td', '', ch.kind)
          if (ch.kind === '新增端点') kindTd.style.color = '#4ade80'
          else if (ch.kind === '端点缺失') kindTd.style.color = '#f87171'
          else kindTd.style.color = '#fbbf24'
          tr.appendChild(kindTd)
          const detailTd = el('td', 'apv-note', ch.detail)
          detailTd.style.whiteSpace = 'normal'
          tr.appendChild(detailTd)
          tbody.appendChild(tr)
        }
        table.appendChild(tbody)
        wrap.appendChild(table)
        return wrap
      }

      const renderBaselineList = (items) => {
        baselineBodyEl.textContent = ''
        baselineTitle.textContent = `契约基线 · ${items.length} 个`
        baselineHelp.textContent = '在「更多」里用当前筛选保存基线，之后随时对比。对比会重新按基线保存时的筛选条件计算当前契约。'
        const table = el('table', 'apv-table')
        const thead = el('thead')
        const headRow = el('tr')
        ;['名称', '保存时间', '端点数', '记录数', '操作'].forEach((h) => headRow.appendChild(el('th', '', h)))
        thead.appendChild(headRow)
        table.appendChild(thead)
        const tbody = el('tbody')
        if (items.length === 0) {
          const row = el('tr')
          const cell = el('td', 'apv-empty', '还没有基线 — 在「更多 ▾」筛选区点「保存基线」，把当前筛选的接口契约存为快照')
          cell.colSpan = 5
          row.appendChild(cell)
          tbody.appendChild(row)
        }
        for (const b of items) {
          const tr = el('tr')
          tr.appendChild(el('td', '', b.name))
          tr.appendChild(el('td', '', b.savedAt ? fmtTime(b.savedAt) : '-'))
          tr.appendChild(el('td', '', String(b.endpoints)))
          tr.appendChild(el('td', '', String(b.records)))
          const opTd = el('td')
          const diffBtn = el('button', 'apv-btn', '对比')
          diffBtn.style.padding = '2px 8px'
          diffBtn.style.fontSize = '11px'
          diffBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            diffBaselineBtn.disabled = true
            apiFetch('/baseline/diff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: b.name }) })
              .then((report) => {
                state.baselineReport = report
                baselineBodyEl.insertBefore(renderBaselineReport(report), baselineBodyEl.firstChild)
              })
              .catch((error) => { console.error('[dsh-api-visualizer] baseline diff failed:', error) })
              .finally(() => { diffBaselineBtn.disabled = false })
          })
          opTd.appendChild(diffBtn)
          const delBtn = el('button', 'apv-btn apv-btn-danger', '删除')
          delBtn.style.padding = '2px 8px'
          delBtn.style.fontSize = '11px'
          delBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            if (!window.confirm(`删除基线「${b.name}」？`)) return
            apiFetch(`/baseline/${encodeURIComponent(b.name)}`, { method: 'DELETE' })
              .then(() => refresh())
              .catch((error) => { console.error('[dsh-api-visualizer] baseline delete failed:', error) })
          })
          opTd.appendChild(delBtn)
          tr.appendChild(opTd)
          tbody.appendChild(tr)
        }
        table.appendChild(tbody)
        baselineBodyEl.appendChild(table)
        if (state.baselineReport !== null && items.some((b) => b.name === state.baselineReport.name)) {
          baselineBodyEl.insertBefore(renderBaselineReport(state.baselineReport), baselineBodyEl.firstChild)
        }
      }

      /** AutoResponder rules panel. */
      const renderRules = (data) => {
        rulesBodyEl.textContent = ''
        const rules = data?.rules ?? []
        if (rules.length === 0) {
          const row = el('tr')
          const cell = el('td', 'apv-empty', '还没有规则 — 在上方填写后点「添加规则」（对正在运行的代理即时生效）')
          cell.colSpan = 8
          row.appendChild(cell)
          rulesBodyEl.appendChild(row)
          return
        }
        const matchText = (r) => {
          const m = r.match
          const parts = []
          if (m.method) parts.push(m.method)
          if (m.url) parts.push(`${m.url} (${m.urlType === 'glob' ? '通配' : m.urlType === 'regex' ? '正则' : '包含'})`)
          if (m.host) parts.push(`host=${m.host}`)
          return parts.join(' ') || '全部'
        }
        const actionText = (r) => {
          const a = r.action
          if (a.type === 'mock') return `mock ${a.status ?? 200}`
          if (a.type === 'delay') return `延迟 ${a.latencyMs ?? 0}ms${a.throttleKbps ? ` · 限速 ${a.throttleKbps}KB/s` : ''}`
          if (a.type === 'block') return '阻断'
          return `重写状态 ${a.status ?? '-'}`
        }
        for (const r of rules) {
          const tr = el('tr')
          const onTd = el('td')
          const onCb = el('input', '')
          onCb.type = 'checkbox'
          onCb.checked = r.enabled !== false
          onCb.title = '启用/停用'
          onCb.addEventListener('change', () => {
            r.enabled = onCb.checked
            saveRules()
          })
          onTd.appendChild(onCb)
          tr.appendChild(onTd)
          tr.appendChild(el('td', '', r.name))
          tr.appendChild(el('td', '', matchText(r)))
          tr.appendChild(el('td', '', actionText(r)))
          tr.appendChild(el('td', '', r.action.latencyMs > 0 ? `${r.action.latencyMs}ms` : '-'))
          const bodyTd = el('td', 'apv-note', r.action.body ? r.action.body.slice(0, 60) + (r.action.body.length > 60 ? '…' : '') : '-')
          bodyTd.title = r.action.body ?? ''
          tr.appendChild(bodyTd)
          tr.appendChild(el('td', '', String(r.hits ?? 0)))
          const opTd = el('td')
          const delBtn = el('button', 'apv-btn apv-btn-danger', '删除')
          delBtn.style.padding = '2px 8px'
          delBtn.style.fontSize = '11px'
          delBtn.addEventListener('click', () => {
            rulesList = rulesList.filter((x) => x.id !== r.id)
            saveRules()
          })
          opTd.appendChild(delBtn)
          tr.appendChild(opTd)
          rulesBodyEl.appendChild(tr)
        }
      }
      let rulesList = []
      const loadRules = () => {
        apiFetch('/proxy/rules').then((data) => {
          rulesList = data?.rules ?? []
          renderRules(data)
        }).catch((error) => {
          console.error('[dsh-api-visualizer] load rules failed:', error)
          rulesList = []
          renderRules({ rules: [] })
        })
      }
      const saveRules = () => {
        apiFetch('/proxy/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rules: rulesList }),
        }).then((data) => {
          rulesList = data?.rules ?? []
          renderRules(data)
        }).catch((error) => {
          console.error('[dsh-api-visualizer] save rules failed:', error)
        })
      }
      ruleAddBtn.addEventListener('click', () => {
        if (ruleNameIn.value.trim() === '' && ruleUrlIn.value.trim() === '') {
          rulesHelp.textContent = '请至少填写规则名称或 URL 匹配'
          return
        }
        rulesList.push({
          name: ruleNameIn.value.trim() || '未命名规则',
          match: { method: ruleMethodSel.value, host: '', url: ruleUrlIn.value.trim(), urlType: ruleTypeSel.value },
          action: {
            type: ruleActionSel.value,
            latencyMs: Number(ruleDelayIn.value) || 0,
            throttleKbps: Number(ruleThrottleIn.value) || 0,
            status: ruleStatusIn.value === '' ? undefined : Number(ruleStatusIn.value),
            body: ruleBodyIn.value,
          },
          hits: 0,
        })
        ruleNameIn.value = ''
        ruleUrlIn.value = ''
        ruleDelayIn.value = ''
        ruleThrottleIn.value = ''
        ruleStatusIn.value = ''
        ruleBodyIn.value = ''
        saveRules()
      })

      sessionBtn.addEventListener('click', () => setView(state.sessionView ? 'table' : 'session'))
      timelineBtn.addEventListener('click', () => setView(state.timelineView ? 'table' : 'timeline'))
      waterfallBtn.addEventListener('click', () => setView(state.waterfallView ? 'table' : 'waterfall'))
      repeatsBtn.addEventListener('click', () => setView(state.repeatsView ? 'table' : 'repeats'))
      baselineBtn.addEventListener('click', () => setView(state.baselineView ? 'table' : 'baseline'))

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
          if (state.minBytes !== '') params.set('minBytes', state.minBytes)
          if (state.maxBytes !== '') params.set('maxBytes', state.maxBytes)
          if (state.fromTs !== '') params.set('fromTs', state.fromTs)
          if (state.toTs !== '') params.set('toTs', state.toTs)
          if (state.sessionId !== '') params.set('sessionId', state.sessionId)
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
          const active = activeView()
          let viewData = null
          if (active === 'session') {
            viewData = await apiFetch(`/stats/sessions?${params.toString()}`).catch(() => null)
          } else if (active === 'timeline') {
            viewData = await apiFetch(`/stats/timeline?bucketMs=60000&${params.toString()}`).catch(() => null)
          } else if (active === 'waterfall') {
            const wp = new URLSearchParams(params.toString())
            wp.set('limit', '500')
            viewData = await apiFetch(`/records?${wp.toString()}`).catch(() => null)
          } else if (active === 'repeats') {
            viewData = await apiFetch(`/stats/repeats?windowMs=10000&minCount=5&${params.toString()}`).catch(() => null)
          } else if (active === 'baseline') {
            viewData = await apiFetch('/baseline/list').catch(() => null)
          }
          renderStats(stat)
          renderCapture(cap)
          renderProxy(prox)
          if (!bpWrap.hidden) loadBreakpoints() // 断点面板打开时随轮询刷新挂起列表
          if (active === 'baseline') renderBaselineSel(viewData?.items ?? [])
          const key = `${stat.total}|${stat.lastTs}|${state.q}|${state.method}|${state.status}|${state.source}|${state.flagged}|${state.host}|${state.ct}|${state.minDur}|${state.minBytes}|${state.maxBytes}|${state.fromTs}|${state.toTs}|${state.sessionId}|${state.errorsOnly}|${state.noNoise}|${state.regex}|${state.bodyQ}|${active}`
          if (key !== state.lastRenderKey) {
            state.lastRenderKey = key
            if (active === 'session') {
              renderSessions(viewData)
            } else if (active === 'timeline') {
              renderTimeline(viewData)
            } else if (active === 'waterfall') {
              renderWaterfall(viewData?.items ?? [])
            } else if (active === 'repeats') {
              renderRepeats(viewData)
            } else if (active === 'baseline') {
              renderBaselineList(viewData?.items ?? [])
            } else if (active === 'agg') {
              apiFetch(`/stats/endpoints?${params.toString()}`).then(renderAgg).catch(() => {})
            } else {
              renderRows(list.items)
            }
          }
        } catch (error) {
          stats.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      const scheduleNext = () => {
        if (!state.open) return
        if (state.timer !== null) clearTimeout(state.timer)
        state.timer = setTimeout(() => {
          state.timer = null
          if (!state.open) return
          if (state.frozen) { scheduleNext(); return } // 冻结：跳过刷新但保持轮询循环
          refresh().finally(scheduleNext)
        }, state.capture.running || state.proxy.running ? POLL_LIVE_MS : POLL_MS)
      }

      const setOpen = (open) => {
        state.open = open
        if (open) {
          if (state.timer !== null) {
            clearTimeout(state.timer)
            state.timer = null
          }
          // exclusive with sibling panels
          delete document.documentElement.dataset.dshTaskboardActive
          delete document.documentElement.dataset.dshSshActive
          delete document.documentElement.dataset.dshPostmanActive
          document.documentElement.dataset.dshApivizActive = 'true'
          if (state.detailHeight !== null) requestAnimationFrame(() => setDetailHeight(state.detailHeight, false))
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
      freezeCb.addEventListener('change', () => {
        state.frozen = freezeCb.checked
        if (!state.frozen) { // 取消冻结：清掉待触发计时器，立即刷新并重启轮询
          if (state.timer !== null) { clearTimeout(state.timer); state.timer = null }
          refresh().finally(scheduleNext)
        }
      })
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
        state.minBytes = minBytesIn.value.trim()
        state.maxBytes = maxBytesIn.value.trim()
        state.fromTs = fromIn.value === '' ? '' : String(Date.parse(fromIn.value))
        state.toTs = toIn.value === '' ? '' : String(Date.parse(toIn.value))
        state.bodyQ = bodyQIn.value.trim()
        refresh()
      }
      for (const input of [hostIn, ctIn, minDurIn, minBytesIn, maxBytesIn, fromIn, toIn, bodyQIn]) {
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
      aggBtn.addEventListener('click', () => setView(state.aggView ? 'table' : 'agg'))
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
        if (state.minBytes !== '') params.set('minBytes', state.minBytes)
        if (state.maxBytes !== '') params.set('maxBytes', state.maxBytes)
        if (state.fromTs !== '') params.set('fromTs', state.fromTs)
        if (state.toTs !== '') params.set('toTs', state.toTs)
        if (state.sessionId !== '') params.set('sessionId', state.sessionId)
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
        q: state.q, method: state.method, status: state.status, source: state.source, flagged: state.flagged, sessionId: state.sessionId,
        host: state.host, ct: state.ct, minDur: state.minDur, minBytes: state.minBytes, maxBytes: state.maxBytes, fromTs: state.fromTs, toTs: state.toTs, errorsOnly: state.errorsOnly, noNoise: state.noNoise, regex: state.regex, bodyQ: state.bodyQ,
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
        minBytesIn.value = f.minBytes ?? ''
        state.minBytes = f.minBytes ?? ''
        maxBytesIn.value = f.maxBytes ?? ''
        state.maxBytes = f.maxBytes ?? ''
        state.fromTs = f.fromTs ?? ''
        state.toTs = f.toTs ?? ''
        state.sessionId = f.sessionId ?? ''
        fromIn.value = state.fromTs !== '' && Number.isFinite(Number(state.fromTs)) ? new Date(Number(state.fromTs) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
        toIn.value = state.toTs !== '' && Number.isFinite(Number(state.toTs)) ? new Date(Number(state.toTs) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
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
      clearFilterBtn.addEventListener('click', () => {
        q.value = ''
        methodSel.value = ''
        statusSel.value = ''
        sourceSel.value = ''
        hostIn.value = ''
        ctIn.value = ''
        minDurIn.value = ''
        minBytesIn.value = ''
        maxBytesIn.value = ''
        fromIn.value = ''
        toIn.value = ''
        bodyQIn.value = ''
        errorsCb.checked = false
        noiseCb.checked = false
        regexCb.checked = false
        state.q = ''
        state.method = ''
        state.status = ''
        state.source = ''
        state.flagged = false
        state.host = ''
        state.ct = ''
        state.minDur = ''
        state.minBytes = ''
        state.maxBytes = ''
        state.fromTs = ''
        state.toTs = ''
        state.sessionId = ''
        state.errorsOnly = false
        state.noNoise = false
        state.regex = false
        state.bodyQ = ''
        flaggedBtn.classList.remove('apv-btn-on')
        refresh()
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
      rotateBtn.addEventListener('click', () => {
        if (!window.confirm('轮转日志：把当前跟踪/调用方日志改名归档为 .bak 并清理过期归档（捕获中会自动先停再启）？')) return
        rotateBtn.disabled = true
        healthHint.style.color = ''
        healthHint.textContent = '正在轮转日志…'
        apiFetch('/capture/rotate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepDays: 7 }) })
          .then((r) => {
            healthHint.textContent = `轮转完成: trace=${r.trace} caller=${r.caller} 清理旧归档 ${r.pruned} 个${r.restarted ? '（已恢复捕获）' : ''}`
            refresh()
          })
          .catch((error) => {
            healthHint.textContent = `轮转失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            rotateBtn.disabled = false
          })
      })
      rulesBtn.addEventListener('click', () => {
        rulesWrap.hidden = !rulesWrap.hidden
        rulesBtn.classList.toggle('apv-btn-on', !rulesWrap.hidden)
        if (!rulesWrap.hidden) { bpWrap.hidden = true; bpBtn.classList.remove('apv-btn-on'); loadRules() }
      })

      // ---- 请求断点面板逻辑
      let bpConfig = { enabled: false, urlFilter: '', methodFilter: '' }
      let bpPausedSig = '' // 挂起集合签名：未变则不重建卡片，保留正在编辑的内容
      const renderBreakpoints = (data) => {
        bpConfig = data?.config ?? bpConfig
        bpEnableCb.checked = bpConfig.enabled === true
        bpBtn.textContent = bpConfig.enabled ? '断点 ●' : '断点'
        if (document.activeElement !== bpUrlIn) bpUrlIn.value = bpConfig.urlFilter ?? ''
        if (document.activeElement !== bpMethodSel) bpMethodSel.value = bpConfig.methodFilter ?? ''
        const paused = data?.paused ?? []
        const sig = (bpConfig.enabled ? '1' : '0') + '|' + paused.map((p) => p.id).join(',')
        if (sig === bpPausedSig) return
        bpPausedSig = sig
        bpPausedEl.textContent = ''
        if (!bpConfig.enabled) { bpPausedEl.appendChild(el('div', 'apv-note', '断点未启用')); return }
        if (paused.length === 0) { bpPausedEl.appendChild(el('div', 'apv-note', '（无挂起请求）启用后命中的请求会在此等待处理')); return }
        for (const item of paused) {
          const card = el('div', 'apv-bp-card')
          card.appendChild(el('div', 'apv-sec-title', `${item.method} ${item.url}`))
          card.appendChild(el('div', 'apv-note', '方法'))
          const mIn = el('input', 'apv-fin')
          mIn.value = item.method
          card.appendChild(mIn)
          card.appendChild(el('div', 'apv-note', '请求头（JSON）'))
          const hIn = el('textarea', 'apv-fin apv-rule-body')
          hIn.value = JSON.stringify(item.reqHeaders ?? {}, null, 2)
          card.appendChild(hIn)
          card.appendChild(el('div', 'apv-note', '请求体'))
          const bIn = el('textarea', 'apv-fin apv-rule-body')
          bIn.value = item.reqBody ?? ''
          card.appendChild(bIn)
          const btns = el('div', 'apv-bp-btns')
          const goBtn = el('button', 'apv-btn', '放行')
          goBtn.addEventListener('click', () => {
            let headers = null
            try { headers = JSON.parse(hIn.value) } catch { window.alert('请求头不是有效 JSON'); return }
            releaseBp(item.id, 'continue', { method: mIn.value.trim(), reqHeaders: headers, reqBody: bIn.value })
          })
          const dropBtn = el('button', 'apv-btn apv-btn-danger', '丢弃')
          dropBtn.addEventListener('click', () => releaseBp(item.id, 'drop', null))
          btns.appendChild(goBtn)
          btns.appendChild(dropBtn)
          card.appendChild(btns)
          bpPausedEl.appendChild(card)
        }
      }
      const loadBreakpoints = () => apiFetch('/proxy/breakpoints').then(renderBreakpoints).catch((error) => { console.error('[dsh-api-visualizer] load breakpoints failed:', error) })
      const saveBreakpoints = () => apiFetch('/proxy/breakpoints', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: bpEnableCb.checked, urlFilter: bpUrlIn.value.trim(), methodFilter: bpMethodSel.value }),
      }).then((data) => { bpPausedSig = ''; renderBreakpoints(data) }).catch((error) => { console.error('[dsh-api-visualizer] save breakpoints failed:', error) })
      const releaseBp = (id, action, edits) => apiFetch('/proxy/breakpoints/release', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action, edits }),
      }).then((data) => { bpPausedSig = ''; renderBreakpoints(data) }).catch((error) => { console.error('[dsh-api-visualizer] release breakpoint failed:', error) })
      bpEnableCb.addEventListener('change', saveBreakpoints)
      bpSaveBtn.addEventListener('click', saveBreakpoints)
      bpBtn.addEventListener('click', () => {
        bpWrap.hidden = !bpWrap.hidden
        bpBtn.classList.toggle('apv-btn-on', !bpWrap.hidden)
        if (!bpWrap.hidden) { rulesWrap.hidden = true; rulesBtn.classList.remove('apv-btn-on'); loadBreakpoints() }
      })
      saveBaselineBtn.addEventListener('click', () => {
        const name = window.prompt('给基线起个名字（保存当前筛选命中的接口契约）：', '基线 ' + new Date().toISOString().slice(0, 10))
        if (name === null || name.trim() === '') return
        saveBaselineBtn.disabled = true
        apiFetch('/baseline/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), filter: currentFilter() }),
        })
          .then((r) => {
            healthHint.textContent = `基线已保存: ${r.name} · ${r.records} 条 · ${r.endpoints} 端点`
            state.baselineName = r.name
            return apiFetch('/baseline/list')
          })
          .then((list) => renderBaselineSel(list?.items ?? []))
          .catch((error) => {
            healthHint.textContent = `保存基线失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            saveBaselineBtn.disabled = false
          })
      })
      diffBaselineBtn.addEventListener('click', () => {
        if (baselineSel.value === '') {
          healthHint.textContent = '请先选择要对比的基线'
          return
        }
        diffBaselineBtn.disabled = true
        apiFetch('/baseline/diff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: baselineSel.value }) })
          .then((report) => {
            state.baselineReport = report
            state.baselineName = report.name
            setView('baseline')
          })
          .catch((error) => {
            healthHint.textContent = `对比失败: ${error instanceof Error ? error.message : String(error)}`
          })
          .finally(() => {
            diffBaselineBtn.disabled = false
          })
      })
      delBaselineBtn.addEventListener('click', () => {
        if (baselineSel.value === '') return
        if (!window.confirm(`删除基线「${baselineSel.value}」？`)) return
        apiFetch(`/baseline/${encodeURIComponent(baselineSel.value)}`, { method: 'DELETE' })
          .then(() => {
            if (state.baselineReport !== null && state.baselineReport.name === baselineSel.value) state.baselineReport = null
            refresh()
          })
          .catch((error) => {
            healthHint.textContent = `删除基线失败: ${error instanceof Error ? error.message : String(error)}`
          })
      })
      baselineSel.addEventListener('change', () => {
        state.baselineName = baselineSel.value
      })
      locateSrcBtn.addEventListener('click', () => {
        if (currentFull === null || currentFull.caller === undefined || currentFull.caller === null) return
        const c = currentFull.caller
        locateSrcBtn.disabled = true
        locateSrcBtn.textContent = '查找中…'
        apiFetch('/source/locate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ vm: c.viewModel, api: c.apiMethod, stack: c.stack }),
        })
          .then((result) => renderSourceHits(result, c))
          .catch((error) => {
            console.error('[dsh-api-visualizer] source locate failed:', error)
            detailBody.insertBefore(makePreSection('定位源码', `查找失败: ${error instanceof Error ? error.message : String(error)}`), detailBody.firstChild)
          })
          .finally(() => {
            locateSrcBtn.disabled = false
            locateSrcBtn.textContent = '定位源码'
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
      // 导出用：游标翻页把匹配记录全部取回（服务端单页 limit 上限 2000，store
      // 上限 20000）。原来导出固定 limit=2000 会静默丢掉更早的记录（丢数据）。
      const fetchAllRecords = async (baseParams) => {
        const all = []
        let cursor = ''
        for (let guard = 0; guard < 40; guard++) { // 40×2000 远超 store 上限，靠 hasMore 收敛
          const p = new URLSearchParams(baseParams)
          p.set('limit', '2000')
          if (cursor !== '') p.set('cursor', cursor)
          const data = await apiFetch(`/records?${p.toString()}`)
          const items = data.items ?? []
          all.push(...items)
          if (data.hasMore !== true || typeof data.nextCursor !== 'string' || data.nextCursor === '' || items.length === 0) break
          cursor = data.nextCursor
        }
        return all
      }
      exportBtn.addEventListener('click', () => {
        const format = exportSel.value
        const redact = exportRedactCb.checked
        exportBtn.disabled = true
        exportBtn.textContent = '导出中…'
        const params = new URLSearchParams({ includeBody: '1' })
        if (state.q !== '') params.set('q', state.q)
        if (state.method !== '') params.set('method', state.method)
        if (state.status !== '') params.set('status', state.status)
        if (state.source !== '') params.set('source', state.source)
        if (state.flagged) params.set('flag', '1')
        if (state.host !== '') params.set('host', state.host)
        if (state.ct !== '') params.set('contentType', state.ct)
        if (state.minDur !== '') params.set('minDurationMs', state.minDur)
        if (state.minBytes !== '') params.set('minBytes', state.minBytes)
        if (state.maxBytes !== '') params.set('maxBytes', state.maxBytes)
        if (state.fromTs !== '') params.set('fromTs', state.fromTs)
        if (state.toTs !== '') params.set('toTs', state.toTs)
        if (state.sessionId !== '') params.set('sessionId', state.sessionId)
        if (state.errorsOnly) params.set('errors', '1')
        if (state.noNoise) params.set('noNoise', '1')
        if (state.regex) params.set('regex', '1')
        if (state.bodyQ !== '') params.set('bodyQ', state.bodyQ)
        fetchAllRecords(params)
          .then((all) => {
            const items = all.map((r) => (redact ? redactRecord(r) : r))
            exportBtn.title = `上次导出 ${items.length} 条`
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
            if (format === 'HAR') {
              downloadBlob(`api-capture-${stamp}.har`, JSON.stringify(buildHar(items), null, 2), 'application/json')
            } else if (format === 'JSON') {
              downloadBlob(`api-capture-${stamp}.json`, JSON.stringify(items, null, 2), 'application/json')
            } else if (format === 'OpenAPI') {
              downloadBlob(`api-capture-${stamp}.openapi.json`, JSON.stringify(buildOpenApi(items), null, 2), 'application/json')
            } else {
              const esc = (v) => {
                const s = v === null || v === undefined ? '' : String(v)
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
              }
              const callerText = (r) => {
                const c = r.caller
                if (c === null || c === undefined) return ''
                const chain = formatCallChain(c.stack)
                if (chain !== '') return chain
                const who = c.viewModel || c.view || ''
                return who + (c.viewModel && c.apiMethod && c.apiMethod !== who ? ' <- ' + c.apiMethod : '')
              }
              const head = ['ts', 'method', 'url', 'status', 'durationMs', 'source', 'caller', 'note', 'tag'].join(',')
              const rows = items.map((r) => [r.ts ?? '', r.method ?? '', esc(r.url ?? ''), r.status ?? '', r.durationMs ?? '', r.source ?? '', esc(callerText(r)), esc(r.note ?? ''), esc(r.tag ?? '')].join(','))
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
      // -------- 导入 HAR / JSON（回灌进捕获库，复用 /ingest）
      const harHeadersToObj = (list) => {
        const out = {}
        for (const h of Array.isArray(list) ? list : []) {
          if (h !== null && typeof h === 'object' && typeof h.name === 'string' && !h.name.startsWith(':')) out[h.name] = String(h.value ?? '')
        }
        return out
      }
      const harToRecords = (entries) => {
        const out = []
        for (const e of entries) {
          if (e === null || typeof e !== 'object') continue
          const req = e.request ?? {}
          const res = e.response ?? {}
          if (typeof req.method !== 'string' || typeof req.url !== 'string') continue
          const rec = { source: 'import', method: req.method, url: req.url, ts: e.startedDateTime ? (Date.parse(e.startedDateTime) || Date.now()) : Date.now() }
          if (Number.isFinite(e.time)) rec.durationMs = Math.round(e.time)
          if (Number.isInteger(res.status) && res.status > 0) rec.status = res.status
          const rh = harHeadersToObj(req.headers)
          if (Object.keys(rh).length > 0) rec.reqHeaders = rh
          const sh = harHeadersToObj(res.headers)
          if (Object.keys(sh).length > 0) rec.resHeaders = sh
          if (req.postData !== null && typeof req.postData === 'object' && typeof req.postData.text === 'string' && req.postData.text !== '') rec.reqBody = req.postData.text
          const content = res.content ?? {}
          if (typeof content.text === 'string' && content.text !== '') {
            rec.resBody = content.encoding === 'base64'
              ? `base64:${String(content.mimeType || 'application/octet-stream').split(';')[0]};${content.text}`
              : content.text
          }
          if (typeof content.mimeType === 'string' && content.mimeType !== '') rec.contentType = content.mimeType
          rec.note = '导入 · HAR'
          out.push(rec)
        }
        return out
      }
      // 解析导入内容：HAR(.log.entries) 或 我们导出的 JSON（记录数组 / {items:[]}）
      const parseImport = (parsed) => {
        if (parsed !== null && typeof parsed === 'object' && parsed.log && Array.isArray(parsed.log.entries)) return harToRecords(parsed.log.entries)
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : [])
        return arr.filter((r) => r !== null && typeof r === 'object' && typeof r.method === 'string' && typeof r.url === 'string')
      }
      const ingestInBatches = async (records) => {
        let total = 0
        for (let i = 0; i < records.length; i += 500) {
          const batch = records.slice(i, i + 500)
          const data = await apiFetch('/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ records: batch }) })
          total += Number(data?.ingested) || batch.length
        }
        return total
      }
      importBtn.addEventListener('click', () => importFile.click())
      importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0]
        if (!file) return
        importBtn.disabled = true
        importBtn.textContent = '导入中…'
        const done = (msg) => { importBtn.disabled = false; importBtn.textContent = '导入'; importFile.value = ''; if (msg) window.alert(msg) }
        const reader = new FileReader()
        reader.onerror = () => done('读取文件失败')
        reader.onload = () => {
          let records
          try {
            records = parseImport(JSON.parse(String(reader.result ?? '')))
          } catch {
            done('解析失败：不是有效的 HAR / JSON 文件')
            return
          }
          if (records.length === 0) { done('文件里没有可导入的记录'); return }
          ingestInBatches(records)
            .then((n) => { importBtn.title = `上次导入 ${n} 条`; refresh() })
            .catch((error) => { console.error('[dsh-api-visualizer] import failed:', error); window.alert('导入失败：' + (error instanceof Error ? error.message : String(error))) })
            .finally(() => done())
        }
        reader.readAsText(file)
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
      // 上下方向键在表格行间移动选中并打开详情（仅表格视图、焦点不在输入控件时）
      const moveSelection = (delta) => {
        if (!state.open || activeView() !== null) return
        const list = renderedRecords
        if (!Array.isArray(list) || list.length === 0) return
        let idx = list.findIndex((r) => r.id === selectedId)
        idx = idx === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + delta))
        const rec = list[idx]
        if (rec === undefined || rec === null) return
        selectedId = rec.id
        const trs = tbody.querySelectorAll('tr')
        trs.forEach((n) => n.classList.remove('apv-selected'))
        const tr = trs[idx]
        if (tr !== undefined && tr !== null) { tr.classList.add('apv-selected'); tr.scrollIntoView({ block: 'nearest' }) }
        apiFetch(`/records/${encodeURIComponent(rec.id)}`).then((full) => { renderDetail(full); detail.hidden = false }).catch((error) => { console.error('[dsh-api-visualizer] detail failed:', error) })
      }
      document.addEventListener('keydown', (event) => {
        if (!state.open) return
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const tag = (event.target && event.target.tagName) || ''
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (activeView() !== null) return
        event.preventDefault()
        moveSelection(event.key === 'ArrowDown' ? 1 : -1)
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
