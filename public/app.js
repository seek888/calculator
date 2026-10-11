// 计算器前端逻辑
// 注意：所有请求都用相对路径 ./api/...（契约 3：/app/<name>/ 路径形态下同源可用）
const $ = (sel) => document.querySelector(sel)

const displayEl = $('#display')
const exprEl = $('#expr')
const hintEl = $('#hint')
const listEl = $('#history-list')
const badgeEl = $('#db-badge')

const OPS_LOCAL = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
}
const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷' }

// 状态：cur 当前输入串；prev 第一个操作数；op 待执行运算符；fresh 下一个数字覆盖输入
let cur = '0'
let prev = null
let op = null
let fresh = true
let errorState = false
let busy = false

function fmtNum(n) {
  return String(parseFloat(n.toPrecision(12)))
}

function render() {
  displayEl.textContent = cur
  displayEl.classList.remove('is-error')
  exprEl.innerHTML =
    prev !== null && op ? `${fmtNum(prev)} ${SYM[op]}` : '&nbsp;'
}

function showError(msg) {
  displayEl.textContent = msg
  displayEl.classList.add('is-error')
  exprEl.innerHTML = '&nbsp;'
  errorState = true
}

function showHint(msg) {
  hintEl.textContent = msg
  hintEl.hidden = false
  clearTimeout(showHint._t)
  showHint._t = setTimeout(() => { hintEl.hidden = true }, 4000)
}

function clearAll() {
  cur = '0'
  prev = null
  op = null
  fresh = true
  errorState = false
  hintEl.hidden = true
  render()
}

function localCalc(a, b, o) {
  if (o === '/' && b === 0) return null
  const r = OPS_LOCAL[o](a, b)
  return Number.isFinite(r) ? parseFloat(r.toPrecision(12)) : null
}

function inputDigit(d) {
  if (errorState) clearAll()
  if (fresh) {
    cur = d === '.' ? '0.' : d
    fresh = false
  } else if (d === '.') {
    if (cur.includes('.')) return
    cur += '.'
  } else if (cur === '0') {
    cur = d
  } else if (cur === '-0') {
    cur = '-' + d
  } else {
    cur += d
  }
  render()
}

function inputOp(o) {
  if (errorState) clearAll()
  if (busy) return
  if (op !== null && !fresh) {
    // 链式运算：先本地算出中间值（不落库），以服务端同款规则收敛精度
    const r = localCalc(prev, Number(cur), op)
    if (r === null) return showError('除数不能为 0')
    prev = r
    cur = String(r)
  } else if (prev === null) {
    prev = Number(cur)
  }
  op = o
  fresh = true
  render()
}

async function equals() {
  if (errorState) clearAll()
  if (busy || op === null || prev === null) return
  const a = prev
  const b = Number(cur)
  const usedOp = op
  if (!Number.isFinite(b)) return
  busy = true
  try {
    const res = await fetch('./api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, b, op: usedOp }),
    })
    const data = await res.json()
    if (!res.ok) return showError(data.error || '计算失败')
    exprEl.textContent = `${data.expression} =`
    displayEl.textContent = data.result
    cur = data.result
    prev = null
    op = null
    fresh = true
    errorState = false
    if (data.saved === false) {
      showHint(data.db ? '已计算，但写入历史失败' : '数据库未连接，本条未存入历史')
    }
    if (data.record) addRecord(data.record)
  } catch (err) {
    showError('网络错误，请重试')
  } finally {
    busy = false
  }
}

function applyPercent() {
  if (errorState) clearAll()
  const v = Number(cur)
  if (!Number.isFinite(v)) return
  cur = fmtNum(v / 100)
  render()
}

function toggleSign() {
  if (errorState) clearAll()
  if (cur.startsWith('-')) cur = cur.slice(1)
  else if (cur !== '0') cur = '-' + cur
  render()
}

function backspace() {
  if (errorState) return clearAll()
  if (fresh) return
  cur = cur.length > 1 ? cur.slice(0, -1) : '0'
  if (cur === '-') cur = '0'
  render()
}

// ---- 历史记录 ----
function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

function addRecord(rec) {
  const empty = listEl.querySelector('.history__empty')
  if (empty) empty.remove()
  const li = document.createElement('li')
  const left = document.createElement('div')
  left.className = 'rec__left'
  const exprSpan = document.createElement('span')
  exprSpan.className = 'rec__expr'
  exprSpan.textContent = `${rec.expression} =`
  const timeSpan = document.createElement('span')
  timeSpan.className = 'rec__time'
  timeSpan.textContent = fmtTime(rec.created_at)
  left.append(exprSpan, timeSpan)
  const resSpan = document.createElement('span')
  resSpan.className = 'rec__res'
  resSpan.textContent = rec.result
  li.append(left, resSpan)
  listEl.prepend(li)
}

async function loadHistory() {
  try {
    const res = await fetch('./api/history')
    if (!res.ok) return
    const data = await res.json()
    listEl.innerHTML = ''
    if (!data.items || data.items.length === 0) {
      listEl.innerHTML = '<li class="history__empty">暂无记录</li>'
      return
    }
    for (const rec of data.items) addRecord(rec)
  } catch (err) {
    /* 静默：列表保持原样 */
  }
}

async function clearHistory() {
  if (!confirm('确定清空全部历史记录？')) return
  try {
    const res = await fetch('./api/history', { method: 'DELETE' })
    if (!res.ok) return showHint('清空失败：数据库未连接或操作失败')
    listEl.innerHTML = '<li class="history__empty">暂无记录</li>'
  } catch (err) {
    showHint('清空失败：网络错误')
  }
}

async function checkDb() {
  try {
    const res = await fetch('./api/health')
    const data = await res.json()
    if (data.db) {
      badgeEl.textContent = '数据库已连接'
      badgeEl.className = 'badge badge--ok'
    } else {
      badgeEl.textContent = '数据库未连接'
      badgeEl.className = 'badge badge--off'
    }
  } catch (err) {
    badgeEl.textContent = '服务异常'
    badgeEl.className = 'badge badge--off'
  }
}

// ---- 事件绑定 ----
document.querySelectorAll('[data-digit]').forEach((btn) =>
  btn.addEventListener('click', () => inputDigit(btn.dataset.digit))
)
document.querySelectorAll('[data-op]').forEach((btn) =>
  btn.addEventListener('click', () => inputOp(btn.dataset.op))
)
document.querySelectorAll('[data-action]').forEach((btn) => {
  const act = btn.dataset.action
  if (act === 'clear') btn.addEventListener('click', clearAll)
  if (act === 'sign') btn.addEventListener('click', toggleSign)
  if (act === 'percent') btn.addEventListener('click', applyPercent)
  if (act === 'back') btn.addEventListener('click', backspace)
  if (act === 'dot') btn.addEventListener('click', () => inputDigit('.'))
  if (act === 'equals') btn.addEventListener('click', equals)
})
$('#clear-history').addEventListener('click', clearHistory)

document.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '9') return inputDigit(e.key)
  if (e.key === '.') return inputDigit('.')
  if (['+', '-', '*', '/'].includes(e.key)) return inputOp(e.key)
  if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); return equals() }
  if (e.key === 'Escape') return clearAll()
  if (e.key === 'Backspace') return backspace()
  if (e.key === '%') return applyPercent()
})

checkDb()
loadHistory()
