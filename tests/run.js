/** 本地测试运行器：node tests/run.js */
const { run } = require('./fw');

require('./test-authz');
require('./test-quota');
require('./test-crud');
require('./test-stats-share');
require('./test-hardening');

(async () => {
  console.log('礼单簿 阶段1 本地测试（内存数据库）\n');
  const ok = await run();
  process.exit(ok ? 0 : 1);
})();
