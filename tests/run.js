/** 本地测试运行器：node tests/run.js */
const { run } = require('./fw');

require('./test-authz');
require('./test-quota');
require('./test-crud');
require('./test-stats-share');
require('./test-hardening');
require('./test-membership');
require('./test-wxstorage');
require('./test-form-state');
require('./test-format');
require('./test-amount-scan');
require('./test-import');
require('./test-export-xlsx');
require('./test-wanglai');
require('./test-admin');
require('./test-admin-config');
require('./test-cloud-export');
require('./test-uppercase');
require('./test-stage3');
require('./test-landscape');
require('./test-landscape-route');
require('./test-invite-reward');

(async () => {
  console.log('礼单簿 阶段1 本地测试（内存数据库）\n');
  const ok = await run();
  process.exit(ok ? 0 : 1);
})();
