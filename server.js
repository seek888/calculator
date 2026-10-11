// 计算器应用服务端（Node / 免 Dockerfile 形态）
// 运行时契约来源：docs/app-deploy-guide.md
//   - 监听 0.0.0.0:$PORT，GET / 启动即可服务（网关探活路径就是根路径）
//   - 数据库连接串只从 DATABASE_URL 读取；启动时自动建表；连接失败自动重试
//   - 日志写 stdout/stderr；运行期不访问外网
const path = require('path')
const express = require('express')
const { Pool } = require('pg')

const PORT = Number(process.env.PORT) || 8080
const DATABASE_URL = process.env.DATABASE_URL || ''

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

// ---------- 数据库（契约 2.3：建表/迁移由应用自己负责，推荐启动时执行） ----------
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 })
  : null
let dbReady = false

async function initDb() {
  if (!pool) {
    console.log('[db] 未设置 DATABASE_URL，历史记录功能停用（其余功能正常）')
    return
  }
  // 连接失败自动重试（契约 5 自检项），重试期间 HTTP 服务不受影响
  for (let attempt = 1; attempt <= 120; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS calc_history (
          id          SERIAL PRIMARY KEY,
          expression  TEXT        NOT NULL,
          result      TEXT        NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      dbReady = true
      console.log('[db] PostgreSQL 已连接，calc_history 表就绪')
      return
    } catch (err) {
      console.error(`[db] 第 ${attempt} 次连接失败：${err.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  console.error('[db] 持续重试仍未连上数据库，历史记录保持停用')
}
if (pool) pool.on('error', (err) => console.error('[db] 连接池后台错误：', err.message))

// ---------- 计算 ----------
const OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
}
const DISPLAY = { '+': '+', '-': '−', '*': '×', '/': '÷' }

// 结果收敛到 12 位有效数字，避免 0.1+0.2=0.30000000000000004 这类浮点噪声
function fmt(n) {
  return String(parseFloat(n.toPrecision(12)))
}

// ---------- API（前端一律用相对路径 fetch ./api/...，兼容 /app/<name>/ 路径形态） ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: dbReady })
})

app.post('/api/calculate', async (req, res) => {
  const a = Number(req.body && req.body.a)
  const b = Number(req.body && req.body.b)
  const op = req.body && req.body.op
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return res.status(400).json({ error: '操作数必须是有限数字' })
  }
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) {
    return res.status(400).json({ error: '不支持的运算符' })
  }
  if (op === '/' && b === 0) {
    return res.status(400).json({ error: '除数不能为 0' })
  }
  const result = OPS[op](a, b)
  if (!Number.isFinite(result)) {
    return res.status(400).json({ error: '结果超出可表示范围' })
  }
  const expression = `${fmt(a)} ${DISPLAY[op]} ${fmt(b)}`
  const value = fmt(result)

  // 数据库不可用时照样返回计算结果，只是不落历史（saved=false 由前端提示）
  if (!dbReady) {
    return res.json({ expression, result: value, saved: false, db: false })
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO calc_history (expression, result) VALUES ($1, $2) RETURNING id, expression, result, created_at',
      [expression, value]
    )
    res.json({ expression, result: value, saved: true, db: true, record: rows[0] })
  } catch (err) {
    console.error('[db] 写入历史失败：', err.message)
    res.json({ expression, result: value, saved: false, db: true })
  }
})

app.get('/api/history', async (req, res) => {
  if (!dbReady) return res.json({ items: [], db: false })
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const { rows } = await pool.query(
      'SELECT id, expression, result, created_at FROM calc_history ORDER BY id DESC LIMIT $1',
      [limit]
    )
    res.json({ items: rows, db: true })
  } catch (err) {
    console.error('[db] 读取历史失败：', err.message)
    res.status(503).json({ error: '数据库读取失败', items: [], db: true })
  }
})

app.delete('/api/history', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: '数据库未连接' })
  try {
    await pool.query('DELETE FROM calc_history')
    res.json({ ok: true })
  } catch (err) {
    console.error('[db] 清空历史失败：', err.message)
    res.status(503).json({ error: '数据库清空失败' })
  }
})

// 未知 API 路径返回 JSON 404，不落进静态文件兜底
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }))

// ---------- 静态页面（契约 3：页面内资源全部相对路径引用） ----------
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }))
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

// JSON 解析错误等统一兜底
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] 请求处理出错：', err.message)
  res.status(err.status || 500).json({ error: err.status ? '请求体不合法' : '服务器内部错误' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] calculator listening on 0.0.0.0:${PORT}`)
  initDb()
})
