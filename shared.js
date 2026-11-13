(() => {
  'use strict';

  const STORAGE_KEY = 'settings';

  const DEFAULT_GROUPS = [
    {
      name: 'Tests',
      icon: 'beaker',
      hidden: false,
      patterns: [
        '*.spec.*',
        '*.test.*',
        '*.e2e-spec.*',
        '*_test.go',
        '*_test.py',
        'test_*.py',
        '*Test.java',
        '*Tests.java',
        '*Test.kt',
        '*Spec.kt',
        '*Tests.cs',
        '*.snap',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/__snapshots__/**',
        '**/test/**',
        '**/tests/**',
        '**/test-*/**',
        '**/spec/**',
        '**/e2e/**',
        '**/*-e2e/**',
      ],
    },
    {
      name: 'Docs',
      icon: 'book',
      hidden: false,
      patterns: ['*.md', '*.mdx', '**/docs/**'],
    },
    {
      name: 'Lockfiles',
      icon: 'lock',
      hidden: false,
      patterns: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '*.lock', 'go.sum'],
    },
  ];

  function newId() {
    return crypto.randomUUID();
  }

  function defaultSettings() {
    return { groups: DEFAULT_GROUPS.map((g) => ({ ...g, id: newId(), patterns: [...g.patterns] })) };
  }

  function globToRegExp(glob) {
    let g = glob.trim();
    if (!g) return null;
    if (g.endsWith('/')) g += '**';
    const anchored = g.includes('/');
    if (g.startsWith('/')) g = g.slice(1);
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*') {
        if (g[i + 1] === '*') {
          i++;
          if (g[i + 1] === '/') {
            i++;
            re += '(?:.*/)?';
          } else {
            re += '.*';
          }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else {
        re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp((anchored ? '^' : '(?:^|/)') + re + '$');
  }

  function compileGroups(groups) {
    return groups.map((group) => {
      const regexes = group.patterns.map(globToRegExp).filter(Boolean);
      return { ...group, matches: (path) => regexes.some((re) => re.test(path)) };
    });
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? defaultSettings();
  }

  function saveSettings(settings) {
    return chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }

  globalThis.PRDiffFilter = { STORAGE_KEY, newId, defaultSettings, globToRegExp, compileGroups, loadSettings, saveSettings };
})();
