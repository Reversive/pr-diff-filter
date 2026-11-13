(() => {
  'use strict';

  const { STORAGE_KEY, compileGroups, loadSettings, saveSettings } = globalThis.PRDiffFilter;
  const { icon } = globalThis.PRDiffFilterIcons;

  const PAGE = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)/;
  const DIFF_ID = /^diff-[0-9a-f]{64}$/;
  const TREE_REF = /^(?:file-tree-item-diff-|.*#diff-)([0-9a-f]{64})$/;
  const HIDDEN = 'prdf-hidden';
  const UI_SELECTOR = '#prdf-root, #prdf-counter';
  const TREE_ITEM = 'li[role="treeitem"]';

  let settings = null;
  let groups = [];
  let panelOpen = false;
  let pageKey = null;
  let files = new Map();
  let pathById = new Map();
  let hashes = new Map();

  const clean = (text) => (text || '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();

  async function sha256(text) {
    if (hashes.has(text)) return hashes.get(text);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    hashes.set(text, hex);
    return hex;
  }

  function insideDiff(node) {
    for (let n = node.parentElement?.closest('[id^="diff-"]'); n; n = n.parentElement?.closest('[id^="diff-"]')) {
      if (DIFF_ID.test(n.id)) return true;
    }
    return false;
  }

  function candidates(diff) {
    const out = new Set();
    const add = (value) => {
      const v = (value || '').replace(/[‎‏]/g, '').trim();
      if (!v || v.length > 400 || v.includes('\n')) return;
      out.add(v);
      for (const part of v.split(/\s+→\s+/)) out.add(part.trim());
    };
    const attrs = ['data-tagsearch-path', 'data-file-path', 'data-path', 'value', 'title'];
    for (const node of [diff, diff.parentElement]) for (const a of attrs) add(node?.getAttribute(a));
    for (const n of diff.querySelectorAll('[data-tagsearch-path],[data-file-path],[data-path],clipboard-copy[value]')) {
      for (const a of attrs) add(n.getAttribute(a));
    }
    const header = diff.querySelectorAll('h3, h3 *, [class*="header" i] a, [class*="header" i] code, [class*="header" i] span');
    for (const n of [...header].slice(0, 40)) add(n.textContent);
    return out;
  }

  async function resolvePath(diff) {
    if (pathById.has(diff.id)) return pathById.get(diff.id);
    const hash = diff.id.slice('diff-'.length);
    for (const candidate of candidates(diff)) {
      if ((await sha256(candidate)) === hash) {
        pathById.set(diff.id, candidate);
        return candidate;
      }
    }
    return null;
  }

  function treeLabel(li) {
    const labelledBy = li.getAttribute('aria-labelledby');
    const byId = labelledBy && document.getElementById(labelledBy.split(' ')[0]);
    if (byId) return clean(byId.textContent);
    const content = li.querySelector(':scope > * [class*="TreeView-item-content-text"], :scope > [class*="TreeView-item-content-text"]');
    if (content) return clean(content.textContent);
    let text = '';
    for (const child of li.children) if (!child.matches('ul, [role="group"]')) text += ' ' + child.textContent;
    return clean(text);
  }

  function treePath(li) {
    const parts = [];
    for (let node = li; node; node = node.parentElement?.closest(TREE_ITEM)) parts.unshift(treeLabel(node));
    return parts.filter(Boolean).join('/');
  }

  function scanTree() {
    const leaves = [...document.querySelectorAll(TREE_ITEM)].filter(
      (li) => !li.hasAttribute('aria-expanded') && !li.querySelector(TREE_ITEM),
    );
    const labelled = leaves
      .filter((li) => !li.querySelector('[data-filterable-item-text]'))
      .map((li) => ({ li, path: treePath(li) }))
      .filter((leaf) => leaf.path);
    return { leaves, labelled };
  }

  async function collect(tree) {
    for (const diff of document.querySelectorAll('[id^="diff-"]')) {
      if (!DIFF_ID.test(diff.id)) continue;
      const path = await resolvePath(diff);
      if (path) files.set(path, diff.id.slice('diff-'.length));
    }
    for (const span of document.querySelectorAll('[data-filterable-item-text]')) {
      const path = span.textContent.trim();
      if (path && !files.has(path)) files.set(path, await sha256(path));
    }
    for (const { path } of tree.labelled) {
      if (!files.has(path)) files.set(path, await sha256(path));
    }
  }

  function treeItemsByHash() {
    const index = new Map();
    for (const n of document.querySelectorAll('a[href*="#diff-"], [id^="file-tree-item-diff-"]')) {
      const hash = (n.id || n.getAttribute('href') || '').match(TREE_REF)?.[1];
      if (!hash || insideDiff(n)) continue;
      const item = n.closest('li') || n;
      if (!index.has(hash)) index.set(hash, []);
      index.get(hash).push(item);
    }
    return index;
  }

  function emptyDirectories(leaves, targets) {
    const totals = new Map();
    const hidden = new Map();
    for (const leaf of leaves) {
      const isHidden = targets.has(leaf);
      for (let dir = leaf.parentElement?.closest(TREE_ITEM); dir; dir = dir.parentElement?.closest(TREE_ITEM)) {
        totals.set(dir, (totals.get(dir) || 0) + 1);
        if (isHidden) hidden.set(dir, (hidden.get(dir) || 0) + 1);
      }
    }
    return [...totals].filter(([dir, total]) => hidden.get(dir) === total).map(([dir]) => dir);
  }

  function fileContainer(diff) {
    let node = diff;
    while (node.parentElement && node.parentElement !== document.body && node.parentElement.childElementCount === 1) {
      node = node.parentElement;
    }
    return node;
  }

  function applyHidden(targets) {
    for (const n of document.querySelectorAll(`.${HIDDEN}`)) if (!targets.has(n)) n.classList.remove(HIDDEN);
    for (const n of targets) if (!n.classList.contains(HIDDEN)) n.classList.add(HIDDEN);
  }

  function render(tree) {
    const linked = location.hash.match(/^#diff-([0-9a-f]{64})/)?.[1];
    const treeIndex = treeItemsByHash();
    const counts = new Map(groups.map((g) => [g.id, 0]));
    const hiddenPaths = new Set();
    const targets = new Set();

    for (const [path, hash] of files) {
      let hide = false;
      for (const g of groups) {
        if (!g.matches(path)) continue;
        counts.set(g.id, counts.get(g.id) + 1);
        if (g.hidden) hide = true;
      }
      if (!hide || hash === linked) continue;
      hiddenPaths.add(path);
      const diff = document.getElementById(`diff-${hash}`);
      if (diff) targets.add(fileContainer(diff));
      for (const item of treeIndex.get(hash) || []) targets.add(item);
    }
    for (const { li, path } of tree.labelled) if (hiddenPaths.has(path)) targets.add(li);
    for (const dir of emptyDirectories(tree.leaves, targets)) targets.add(dir);

    const original = renderCounter(hiddenPaths.size);
    if (original) targets.add(original);
    applyHidden(targets);
    renderUi(counts, hiddenPaths.size);
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.append(child);
    return node;
  }

  function ensureRoot() {
    let root = document.getElementById('prdf-root');
    if (!root) {
      root = el('div', { id: 'prdf-root' });
      root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !panelOpen) return;
        panelOpen = false;
        renderNow();
        root.querySelector('[data-key="pill"]')?.focus();
      });
      document.body.append(root);
    }
    root.hidden = false;
    return root;
  }

  function renderUi(counts, hiddenCount) {
    const root = ensureRoot();
    const signature = JSON.stringify([panelOpen, hiddenCount, groups.map((g) => [g.id, g.name, g.icon, g.hidden, counts.get(g.id)])]);
    if (root.dataset.signature === signature) return;
    root.dataset.signature = signature;
    const focused = root.contains(document.activeElement) ? document.activeElement.dataset.key : null;

    const pill = el(
      'button',
      {
        type: 'button',
        className: 'prdf-pill',
        title: 'PR Diff Filter',
        onclick: () => {
          panelOpen = !panelOpen;
          renderNow();
        },
      },
      [icon('filter'), el('span', { textContent: hiddenCount ? `${hiddenCount} hidden` : 'Filter files' })],
    );
    pill.dataset.key = 'pill';
    pill.setAttribute('aria-expanded', String(panelOpen));
    pill.setAttribute('aria-controls', 'prdf-panel');
    if (hiddenCount) pill.classList.add('prdf-active');

    const nodes = [];
    if (panelOpen) {
      const rows = groups.map((g) => {
        const count = counts.get(g.id);
        const row = el(
          'button',
          {
            type: 'button',
            className: 'prdf-row',
            title: g.hidden ? `Show ${g.name}` : `Hide ${g.name}`,
            onclick: () => toggleGroup(g.id),
          },
          [
            icon(g.icon),
            el('span', { className: 'prdf-name', textContent: g.name }),
            el('span', { className: 'prdf-count', textContent: String(count) }),
            icon(g.hidden ? 'eye-closed' : 'eye', 'prdf-icon prdf-state'),
          ],
        );
        row.dataset.key = `group:${g.id}`;
        row.setAttribute('aria-pressed', String(g.hidden));
        if (!count) row.classList.add('prdf-empty');
        return row;
      });
      const settingsLink = el(
        'button',
        { type: 'button', className: 'prdf-row prdf-link', onclick: openOptions },
        [icon('gear'), el('span', { className: 'prdf-name', textContent: 'Edit filters…' })],
      );
      settingsLink.dataset.key = 'settings';
      nodes.push(
        el('div', { id: 'prdf-panel', className: 'prdf-panel' }, [
          el('div', { className: 'prdf-title', textContent: 'Hide in pull requests' }),
          ...rows,
          el('div', { className: 'prdf-divider' }),
          settingsLink,
        ]),
      );
    }
    nodes.push(pill);
    root.replaceChildren(...nodes);
    if (focused) root.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
  }

  function filesTabCounter() {
    const byId = document.getElementById('files_tab_counter');
    if (byId) return byId;
    for (const a of document.querySelectorAll('a[href*="/pull/"]')) {
      if (!/\/pull\/\d+\/(files|changes)\/?$/.test(new URL(a.href, location.href).pathname)) continue;
      for (const c of a.querySelectorAll('.Counter, [class*="Counter"]')) {
        if (c.id !== 'prdf-counter' && /^\s*[\d,.]+\s*$/.test(c.textContent)) return c;
      }
    }
    return null;
  }

  function renderCounter(hiddenCount) {
    const original = filesTabCounter();
    let mine = document.getElementById('prdf-counter');
    const total = original ? parseInt(original.textContent.replace(/\D/g, ''), 10) : 0;
    if (!hiddenCount || !total) {
      mine?.remove();
      return null;
    }
    if (!mine || mine.previousElementSibling !== original) {
      mine?.remove();
      mine = original.cloneNode(false);
      mine.id = 'prdf-counter';
      mine.classList.remove(HIDDEN);
      original.after(mine);
    }
    const text = `${Math.max(total - hiddenCount, 0)}/${total}`;
    if (mine.textContent !== text) mine.textContent = text;
    mine.title = `${hiddenCount} files hidden by PR Diff Filter`;
    return original;
  }

  function openOptions() {
    try {
      chrome.runtime.sendMessage('open-options').catch(() => {});
    } catch {}
  }

  function renderNow() {
    render(scanTree());
  }

  function toggleGroup(id) {
    settings = { ...settings, groups: settings.groups.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)) };
    groups = compileGroups(settings.groups);
    renderNow();
    try {
      saveSettings(settings).catch((error) => console.error('PR Diff Filter: could not save settings', error));
    } catch (error) {
      console.error('PR Diff Filter: could not save settings', error);
    }
  }

  function leavePage() {
    applyHidden(new Set());
    document.getElementById('prdf-counter')?.remove();
    const root = document.getElementById('prdf-root');
    if (root) root.hidden = true;
  }

  let running = false;
  let pending = false;
  async function update() {
    if (!settings) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        if (!PAGE.test(location.pathname)) {
          leavePage();
          continue;
        }
        if (location.pathname !== pageKey) {
          pageKey = location.pathname;
          files = new Map();
          pathById = new Map();
          hashes = new Map();
        }
        const tree = scanTree();
        await collect(tree);
        render(tree);
      } while (pending);
    } finally {
      running = false;
    }
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 150);
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]?.newValue) return;
    settings = changes[STORAGE_KEY].newValue;
    groups = compileGroups(settings.groups);
    schedule();
  });

  new MutationObserver((mutations) => {
    if (mutations.every((m) => m.target.closest?.(UI_SELECTOR))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  for (const evt of ['turbo:load', 'popstate', 'pjax:end', 'hashchange']) window.addEventListener(evt, schedule);

  loadSettings().then((loaded) => {
    settings = loaded;
    groups = compileGroups(settings.groups);
    update();
  });
})();
