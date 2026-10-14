import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

const configured = process.env.DATABASE_PATH ?? './data/clover.db'
const resolved = path.resolve(configured)
fs.mkdirSync(path.dirname(resolved), { recursive: true })

const sqlite = new Database(resolved)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

/**
 * 唯一事实源。账号/域名/别名的最终落地走 src/lib/dms.ts 的 DMS setup CLI，
 * 本 DB 与之每日对账（src/lib/reconcile.ts）。
 */
export const db = drizzle(sqlite, { schema })
export { sqlite, resolved as databasePath }

// 启动即迁移（幂等）：schema 变更随部署自动就位。
// 注意：放在本模块而非 instrumentation.ts —— Next 15 会把 instrumentation
// 按 edge 目标编译，node:fs 无法解析，better-sqlite3 会构建失败。
const migrationsFolder = path.resolve(process.cwd(), 'drizzle')
if (fs.existsSync(migrationsFolder)) {
  migrate(db, { migrationsFolder })
  console.log('[clover] database migrations applied:', migrationsFolder)
} else {
  console.warn('[clover] 未找到 drizzle/ 迁移目录，schema 可能缺失（先跑 npx drizzle-kit generate）')
}
