// 词条按功能域拆分，新增文案时改对应命名空间文件即可。
import type { Messages } from '../types'
import common from './en/common'
import nav from './en/nav'
import dashboard from './en/dashboard'
import cloudflare from './en/cloudflare'
import domains from './en/domains'
import dns from './en/dns'
import environment from './en/environment'
import certificates from './en/certificates'
import panelSettings from './en/panelSettings'
import mailboxes from './en/mailboxes'
import mailSettings from './en/mailSettings'
import routing from './en/routing'
import settings from './en/settings'
import updates from './en/updates'
import monitor from './en/monitor'
import apiDocs from './en/apiDocs'
import login from './en/login'
import webmail from './en/webmail'
import mailGuide from './en/mailGuide'
import apiErrors from './en/apiErrors'
import apiSystem from './en/apiSystem'
import apiAuth from './en/apiAuth'

export const en: Messages = {
  common,
  nav,
  dashboard,
  cloudflare,
  domains,
  dns,
  environment,
  certificates,
  panelSettings,
  mailboxes,
  mailSettings,
  routing,
  settings,
  updates,
  monitor,
  apiDocs,
  login,
  webmail,
  mailGuide,
  apiErrors,
  apiSystem,
  apiAuth,
}
