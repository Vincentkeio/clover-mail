const login = {
  invalidCredentials: '用户名或密码错误',
  tooManyAttempts: '登录尝试过于频繁，请在 15 分钟后重试。',
  adminCreated: '管理员已创建，请登录',
  noAdminLead: '尚未创建管理员。请通过 SSH 登录服务器并运行',
  noAdminTail: '，然后返回此页登录。',
  username: '用户名',
  totpLabel: '两步验证码',
  totpRequired: '请输入两步验证码',
  invalidTotp: '验证码不正确或已过期，请重试',
  signingIn: '登录中…',
  submit: '登 录',
  passkeySubmit: '用 Passkey 登录',
  passkeyNotRegistered: '该账号未注册 Passkey',
  passkeyFailed: 'Passkey 登录失败',
  passkeyInterrupted: 'Passkey 登录中断：{message}',
}

export default login
