(function () {
  'use strict';

  var key = 'wornpage-nebius-theme-v1';
  var choices = ['neutral-system', 'neutral-light', 'neutral-dark', 'original-system', 'original-light', 'original-dark'];
  var fallback = 'neutral-system';
  var saveFailure = 'Theme changed for this tab; your browser could not save it.';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var storage = null;
  var choice = fallback;
  var lastPersisted = null;

  function valid(value) {
    return typeof value === 'string' && choices.indexOf(value) !== -1;
  }

  try {
    storage = window.localStorage;
    var saved = storage.getItem(key);
    if (valid(saved)) choice = saved;
  } catch (_) {
    // The safe default remains usable when browser storage is unavailable.
  }

  function syncSelects() {
    document.querySelectorAll('select[data-wornpage-theme]').forEach(function (select) {
      select.value = choice;
      var status = select.parentElement.querySelector('[data-wornpage-theme-status]');
      if (!status && lastPersisted === false) {
        status = document.createElement('span');
        status.setAttribute('data-wornpage-theme-status', '');
        status.setAttribute('role', 'status');
        select.parentElement.appendChild(status);
      }
      if (status) status.textContent = lastPersisted === false ? saveFailure : '';
    });
  }

  function apply(next, persisted) {
    choice = next;
    if (typeof persisted === 'boolean') lastPersisted = persisted;
    var parts = choice.split('-');
    var resolved = parts[1] === 'system' ? (media.matches ? 'dark' : 'light') : parts[1];
    var root = document.documentElement;
    root.setAttribute('data-palette', parts[0]);
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-choice', choice);
    syncSelects();
    window.dispatchEvent(new CustomEvent('wornpage:themechange', {
      detail: { choice: choice, theme: resolved, persisted: persisted }
    }));
  }

  window.WornpageTheme = Object.freeze({
    getChoice: function () { return choice; },
    setChoice: function (next) {
      if (!valid(next)) throw new TypeError('Unknown theme choice.');
      var persisted = false;
      try {
        // Retry access in case storage became available after initialization.
        storage = window.localStorage;
        storage.setItem(key, next);
        persisted = true;
      } catch (_) {
        // The preference still applies in this tab.
      }
      apply(next, persisted);
      return { choice: choice, persisted: persisted };
    }
  });

  apply(choice, null);

  media.addEventListener('change', function () {
    if (choice.endsWith('-system')) apply(choice, null);
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    // Ignore sessionStorage and unrelated storage owners.
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch (_) { return; }
    apply(valid(event.newValue) ? event.newValue : fallback, true);
  });
  document.addEventListener('DOMContentLoaded', syncSelects);
  document.addEventListener('change', function (event) {
    var target = event.target;
    if (target instanceof HTMLSelectElement && target.matches('[data-wornpage-theme]')) {
      if (valid(target.value)) window.WornpageTheme.setChoice(target.value);
      else syncSelects();
    }
  });
}());
