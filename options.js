(() => {
  'use strict';

  const { newId, defaultSettings, compileGroups, loadSettings, saveSettings } = globalThis.PRDiffFilter;
  const { GROUP_ICONS, icon } = globalThis.PRDiffFilterIcons;

  const list = document.getElementById('groups');
  const template = document.getElementById('group-template');
  const status = document.getElementById('status');
  const tryInput = document.getElementById('try');
  const tryResult = document.getElementById('try-result');

  function renderIconPicker(card, selected) {
    card.dataset.icon = selected;
    card.querySelector('.icon-picker').replaceChildren(
      ...GROUP_ICONS.map((name) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = name;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', name);
        button.setAttribute('aria-checked', String(name === selected));
        button.append(icon(name));
        button.addEventListener('click', () => renderIconPicker(card, name));
        return button;
      }),
    );
  }

  function addGroupCard(group) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = group.id;
    renderIconPicker(card, group.icon || 'file');
    card.querySelector('.name').value = group.name;
    card.querySelector('.patterns').value = group.patterns.join('\n');
    card.querySelector('.remove').addEventListener('click', () => {
      card.remove();
      refreshTry();
    });
    card.addEventListener('input', refreshTry);
    list.append(card);
  }

  function readGroups() {
    return [...list.querySelectorAll('.group')].map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.name').value.trim() || 'Untitled',
      icon: card.dataset.icon,
      patterns: card
        .querySelector('.patterns')
        .value.split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
    }));
  }

  function renderAll(settings) {
    list.replaceChildren();
    settings.groups.forEach(addGroupCard);
    refreshTry();
  }

  function refreshTry() {
    const path = tryInput.value.trim();
    if (!path) {
      tryResult.textContent = '';
      return;
    }
    const matched = compileGroups(readGroups()).filter((g) => g.matches(path.replace(/^\/+/, '')));
    tryResult.textContent = matched.length ? `Matches: ${matched.map((g) => g.name).join(', ')}` : 'No filter matches this path.';
  }

  function flash(text) {
    status.textContent = text;
    setTimeout(() => {
      if (status.textContent === text) status.textContent = '';
    }, 4000);
  }

  document.getElementById('add').addEventListener('click', () => {
    addGroupCard({ id: newId(), name: '', icon: 'file', patterns: [] });
    list.lastElementChild.querySelector('.name').focus();
  });

  document.getElementById('save').addEventListener('click', async () => {
    try {
      const stored = await loadSettings();
      const hiddenById = new Map(stored.groups.map((g) => [g.id, g.hidden]));
      const groups = readGroups().map((g) => ({ ...g, hidden: hiddenById.get(g.id) ?? false }));
      await saveSettings({ groups });
      flash('Saved. Open pull requests update right away.');
    } catch (error) {
      flash(`Could not save: ${error.message}`);
    }
  });

  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Replace your filters with the defaults?')) return;
    renderAll(defaultSettings());
    flash('Defaults loaded. Save to keep them.');
  });

  tryInput.addEventListener('input', refreshTry);

  loadSettings().then(renderAll);
})();
