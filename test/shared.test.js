const test = require('node:test');
const assert = require('node:assert/strict');

require('../shared.js');
const { globToRegExp, compileGroups, defaultSettings } = globalThis.PRDiffFilter;

test('globToRegExp', () => {
  const cases = [
    ['*.md', 'README.md', true],
    ['*.md', 'docs/a/b.md', true],
    ['*.md', 'a.mdx', false],
    ['/README.md', 'README.md', true],
    ['/README.md', 'a/README.md', false],
    ['docs/', 'docs/a/b.md', true],
    ['docs/', 'pkg/docs/a.md', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/b/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/b/c/a.ts', true],
    ['**/test/**', 'a/test/b.ts', true],
    ['a?.js', 'a1.js', true],
    ['a(b).js', 'a(b).js', true],
  ];
  for (const [glob, path, expected] of cases) assert.equal(globToRegExp(glob).test(path), expected, `${glob} vs ${path}`);
  assert.equal(globToRegExp('   '), null);
});

test('default groups', () => {
  const groups = compileGroups(defaultSettings().groups);
  const match = (path) => groups.filter((g) => g.matches(path)).map((g) => g.name).join(',');
  const cases = {
    'libs/a/src/a.service.spec.ts': 'Tests',
    'libs/a/src/a.integration.spec.ts': 'Tests',
    'apps/api-e2e/src/a.ts': 'Tests',
    'test-integration/utils/a.ts': 'Tests',
    'pkg/a_test.go': 'Tests',
    'src/main/java/FooTest.java': 'Tests',
    'docs/agents/architecture.md': 'Docs',
    'pnpm-lock.yaml': 'Lockfiles',
    'libs/a/src/a.service.ts': '',
    'libs/a/src/testing.ts': '',
    'src/latest.ts': '',
    'src/contest/a.ts': '',
  };
  for (const [path, expected] of Object.entries(cases)) assert.equal(match(path), expected, path);
});
