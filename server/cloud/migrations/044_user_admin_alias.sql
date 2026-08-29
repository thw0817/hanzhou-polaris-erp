ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_label text NOT NULL DEFAULT '';

COMMENT ON COLUMN users.admin_label IS
  '管理员专属账户别名，仅用于管理员视图，不改变用户真实显示名称、邮箱或登录身份。';
