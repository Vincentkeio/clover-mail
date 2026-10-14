#!/usr/bin/env node
const Database = require('better-sqlite3')
const { hash } = require('@node-rs/argon2')

const dbPath = process.env.DATABASE_PATH || '/app/data/clover.db'
const db = new Database(dbPath)
const [action, username, newUsername] = process.argv.slice(2)
const usernamePattern = /^[a-zA-Z0-9_-]{2,32}$/

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

async function main() {
  if (action === 'list') {
    const rows = db.prepare('SELECT username, created_at, last_login_at FROM admins ORDER BY id').all()
    if (!rows.length) {
      console.log('尚未创建管理员。请通过 SSH 运行：clover admin create')
      return
    }
    console.log('管理员账户（密码不可读取；忘记密码时可通过 CLI 重置）：')
    for (const row of rows) {
      console.log(`- ${row.username} · 创建于 ${row.created_at} · 最近登录 ${row.last_login_at || '从未'}`)
    }
    return
  }

  let password = ''
  for await (const chunk of process.stdin) password += chunk
  password = password.replace(/\r?\n$/, '')

  if (action === 'create') {
    if (!usernamePattern.test(username || '')) return fail('用户名需为 2–32 位字母、数字、下划线或短横线。')
    if (password.length < 12 || password.length > 128) {
      return fail('密码长度需为 12–128 位。')
    }
    const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    const replaceAdmin = db.transaction(() => {
      const previous = db.prepare('SELECT username FROM admins ORDER BY id').all()
      db.prepare('DELETE FROM admins').run()
      db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
        .run(username, passwordHash, new Date().toISOString())
      return previous.map((row) => row.username)
    })
    const previous = replaceAdmin()
    if (previous.length) {
      console.log(`管理员 ${username} 已创建并替换原管理员（${previous.join('、')}）。旧管理员的两步验证和 Passkey 不会转移，旧登录会话已失效。`)
    } else {
      console.log(`管理员 ${username} 已创建。现在可登录面板。`)
    }
    return
  }

  if (action === 'reset') {
    if (password.length < 12 || password.length > 128) {
      return fail('密码长度需为 12–128 位。')
    }
    const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    const result = db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(passwordHash, username)
    if (!result.changes) return fail(`找不到管理员：${username}`)
    console.log(`管理员 ${username} 的密码已重置；已启用的两步验证保持不变。`)
    return
  }

  if (action === 'rename') {
    if (!usernamePattern.test(newUsername || '')) return fail('新用户名需为 2–32 位字母、数字、下划线或短横线。')
    const result = db.prepare('UPDATE admins SET username = ? WHERE username = ?').run(newUsername, username)
    if (!result.changes) return fail(`找不到管理员：${username}`)
    console.log(`管理员用户名已改为 ${newUsername}。`)
    return
  }

  fail('未知操作。支持 list、create、reset、rename。')
}

main().catch((error) => {
  if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') fail('该管理员用户名已存在。')
  else fail(`管理员操作失败：${error instanceof Error ? error.message : String(error)}`)
}).finally(() => db.close())
