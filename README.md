# calculator — AppDock 计算器应用

网页计算器（Node.js + Express），支持四则运算，**计算历史存入 PostgreSQL**。
按 `docs/app-deploy-guide.md`（AppDock 应用部署契约）开发，可直接部署到任何 AppDock 控制台。

## 功能

- 网页计算器：+ − × ÷、±、%、退格、清零，支持键盘输入
- 每次按 `=` 由服务端计算并写入数据库（PostgreSQL），页面右侧展示历史记录、可一键清空
- 数据库未连接时计算功能照常可用，仅不落历史，页面顶部有状态提示

## 部署到 AppDock

### 方式一：git 仓库（网络可达 GitHub 的控制台）

创建应用 → 部署方式选 git，填本仓库地址即可（平台浅克隆 → 识别 `package.json` → nixpacks 构建 → `npm start`）。

### 方式二：zip 源码包

```bash
git archive -o calculator.zip HEAD
# 控制台创建应用后，部署页拖入 calculator.zip
# 或：curl -X POST -F file=@calculator.zip http://<控制台地址>/api/v1/apps/calculator/deploy
```

> zip 根目录即工程根（`package.json` 在根），无多余一层目录。

### 应用名建议

`calculator`（2~32 位小写字母/数字/中划线），访问地址形如 `http://<平台地址>/app/calculator/`。

## 运行时契约对照（平台注入的环境变量）

| 变量 | 用法 |
|---|---|
| `PORT` | 服务监听 `0.0.0.0:$PORT`（默认 8080），`GET /` 即探活路径，启动即可服务 |
| `DATABASE_URL` | PostgreSQL 连接串；启动时自动建表 `calc_history`，连接失败每 2 秒重试 |
| `DATA_DIR` | 本应用不写文件，未使用 |

- 前端资源全部**相对路径**引用，兼容 `/app/<name>/` 路径访问形态与子域名形态
- 依赖仅 `express` + `pg`，内存占用远低于 256MB 上限，单进程
- 运行期不访问任何外网服务

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ ok, db }`，db 表示数据库是否就绪 |
| POST | `/api/calculate` | body `{ "a": 1, "b": 2, "op": "+" }`，op ∈ `+ - * /`；返回计算结果并落历史 |
| GET | `/api/history?limit=50` | 最近历史（新→旧），最多 200 条 |
| DELETE | `/api/history` | 清空历史 |

错误约定：除数为 0、非法运算符、非数字 → `400 { "error": "..." }`；数据库不可用时计算仍返回 200，带 `saved: false`。

## 数据表

```sql
CREATE TABLE IF NOT EXISTS calc_history (
  id          SERIAL PRIMARY KEY,
  expression  TEXT        NOT NULL,  -- 如 "12.5 × 3"
  result      TEXT        NOT NULL,  -- 如 "37.5"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 本地开发

```bash
npm install
npm start            # 不设 DATABASE_URL 也能跑，历史功能停用
# 可选：连本地 PostgreSQL
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/calculator npm start
```

打开 http://127.0.0.1:8080 （可用 `PORT` 环境变量改端口）。

## 目录结构

```
calculator/
├── package.json        # nixpacks 识别标志；start: node server.js
├── server.js           # HTTP 服务 + API + 建表/重试
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js          # 前端计算器逻辑（相对路径请求 ./api/...）
└── README.md
```
