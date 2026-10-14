/** 面板运行配置（从环境读取，Docker 侧由 compose 注入） */
export const config = {
  databasePath: process.env.DATABASE_PATH ?? './data/clover.db',
  /** docker exec 的目标容器名（compose 中固定为 docker-mailserver） */
  dmsContainer: process.env.DMS_CONTAINER ?? 'docker-mailserver',
  panelUrl: process.env.PANEL_URL ?? '',
  /** 初始管理员用户名（M4 首次启动时引导创建） */
  bootstrapAdmin: process.env.ADMIN_BOOTSTRAP_USER ?? 'admin',
  /** Cloudflare API Token（M2 DNS 推送用） */
  cfApiToken: process.env.CF_API_TOKEN ?? '',
} as const
