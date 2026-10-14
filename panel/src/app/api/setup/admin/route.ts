import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** 禁用公网首次建号；管理员创建/重置只允许服务器 CLI。 */
export async function POST() {
  return NextResponse.json({ error: 'admin_setup_disabled' }, { status: 404 })
}
