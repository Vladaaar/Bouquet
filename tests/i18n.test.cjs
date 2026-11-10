const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const [name, navigator, expected] of [
  ['Russian region', { languages: ['ru-RU', 'en-US'] }, 'ru'],
  ['English preference', { languages: ['en-GB', 'ru'] }, 'en'],
  ['first supported preference', { languages: ['de-DE', 'RU-ru', 'en'] }, 'ru'],
  ['language fallback', { language: 'ru-RU' }, 'ru'],
  ['unsupported languages', { languages: ['fr-FR'] }, 'en'],
  ['missing navigator', undefined, 'en']
]) test(`system language: ${name}`, () => {
  let lang = 'ru';
  const context = vm.createContext({ navigator, document: {
    documentElement: { getAttribute: () => lang, setAttribute: (_, value) => { lang = value; } }, querySelectorAll: () => []
  } });
  context.window = context;
  for (const file of ['bouquet', 'i18n']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../core/' + file + '.js'), 'utf8'), context);
  const I = context.Bouquet.i18n;
  assert.equal(I.locale, expected);
  assert.equal(lang, expected);
  assert.equal(I.t('open'), expected === 'ru' ? 'Открыть' : 'Open');
  const other = expected === 'ru' ? 'en' : 'ru';
  I.setLanguage('language-' + other);
  assert.equal(I.locale, other);
  assert.equal(lang, other);
});
