/** 测试小框架：assert + 用例注册 */
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}
assert.eq = (a, b, msg) => assert(a === b, `${msg} (期望${b}, 实际${a})`);

async function run() {
  let pass = 0, fail = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${name}\n    ${e.message}`);
    }
  }
  console.log(`\n通过 ${pass} / 失败 ${fail} / 共 ${cases.length}`);
  return fail === 0;
}

module.exports = { test, assert, run };
