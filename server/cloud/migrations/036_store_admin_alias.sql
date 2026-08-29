ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS admin_label text NOT NULL DEFAULT '';

COMMENT ON COLUMN stores.admin_label IS
  '管理员专属店铺别称，仅用于管理员视图，不改变成员看到的店铺名称。';
