// ============================================================
// obfuscate.js — QuickAdd User Script для Obsidian
// Обфусцирует / восстанавливает текст по regex-правилам.
// Карта замен хранится в конце заметки в %% ... %% блоке.
// ============================================================
//
// Как подключить:
//   1. Положи этот файл в папку scripts/ внутри vault.
//   2. В QuickAdd → Manage Macros → New Macro:
//      — "Obfuscate selection" → User Script → obfuscate.js → export: obfuscateSelection
//      — "Restore selection"  → User Script → obfuscate.js → export: restoreSelection
//   3. Settings → Hotkeys → найди оба macro → назначь сочетания клавиш.
//
// Использование:
//   — Выдели текст → нажми хоткей обфускации.
//   — Выдели текст с токенами [[token_1]] → нажми хоткей восстановления.
//
// ============================================================


// ============================================================
// МАРКЕРЫ блока карты замен в конце заметки
// Блок будет выглядеть как:
//   %%obfuscation-map-start%%
//   { "mail_1": { "original": "...", ... } }
//   %%obfuscation-map-end%%
// %% ... %% — стандартный комментарий в Obsidian,
// не виден в режиме чтения.
// ============================================================
const MAP_START = "%%obfuscation-map-start%%";
const MAP_END   = "%%obfuscation-map-end%%";


// ============================================================
// СТАНДАРТНЫЕ ПРАВИЛА
//
// Обрабатываются в порядке объявления — ПОРЯДОК ВАЖЕН!
// URL нужно обрабатывать ДО доменов, иначе домен внутри URL
// совпадёт раньше regex URL и токен будет некорректным.
// Аналогично email ДО доменов — иначе "user@example.com"
// разобьётся на "user@" + домен "example.com".
//
// Поля:
//   prefix       — префикс токена: url_1, mail_2, domain_3
//   regex        — JavaScript RegExp (обязательно с флагом g)
//   replaceWith  — null: токен без замены текста;
//                  строка: заменить на эту строку (исходник в карте)
//   storeOriginal — true: сохранить оригинал в карту замен
//                   false: просто заменить, карту не трогать
// ============================================================
const DEFAULT_RULES = [
  // URL обязательно ДО доменов — он содержит домен внутри себя
  {
    prefix: "url",
    regex: /\bhttps?:\/\/[^\s<>\])}]+/gi,
    replaceWith: null,
    storeOriginal: true
  },
  // Email обязательно ДО доменов — иначе часть после @ захватится domain-правилом
  {
    prefix: "mail",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replaceWith: null,
    storeOriginal: true
  },
  // Домен — последним среди трёх стандартных правил.
  // Сработает только на то, что не было захвачено URL и email выше.
  {
    prefix: "domain",
    regex: /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi,
    replaceWith: null,
    storeOriginal: true
  }
];


// ============================================================
// ПОЛЬЗОВАТЕЛЬСКИЕ ПРАВИЛА
//
// Добавляй свои правила в массив CUSTOM_RULES.
// Они выполняются ПОСЛЕ стандартных правил.
//
// ⚠️ Важные предупреждения:
//
// 1. ПОРЯДОК ИМЕЕТ ЗНАЧЕНИЕ.
//    Если два regex могут пересекаться — ставь более специфичный выше.
//    Пример: если есть правило на "planet.ru" и отдельно на ".ru",
//    правило "planet.ru" должно стоять ВЫШЕ ".ru".
//
// 2. REGEX НЕ ДОЛЖНЫ ВХОДИТЬ ДРУГ В ДРУГА.
//    Если правило A уже захватило подстроку, правило B её не увидит.
//    Пример: url_regex уже захватил "https://planet.ru/path",
//    поэтому ни org-правило (planet), ни zone-правило (.ru)
//    внутри этого URL уже не сработают — это корректное поведение.
//
// 3. ГРАНИЧНЫЕ СИМВОЛЫ \W и \b.
//    Если в regex используется \W (любой не-буквенный символ),
//    он входит в совпадение! Это значит, что:
//      — replaceWith тоже должен оканчиваться на пробел/символ,
//        чтобы не "склеить" соседние слова.
//    Безопаснее использовать lookahead: /\bplanet(?=\W)/gi
//    Тогда граничный символ не захватывается, и replaceWith — просто слово.
//
// 4. ФЛАГ g ОБЯЗАТЕЛЕН.
//    Без флага g regex сработает только на первое совпадение.
//
// ============================================================
//
// Примеры форматов:
//
// Простая замена слова (сохранить оригинал):
//   { prefix: "org",  regex: /\bplanet(?=\W)/gi, replaceWith: "jupiter", storeOriginal: true }
//
// Замена окончания домена:
//   { prefix: "zone", regex: /\.ru\b/gi, replaceWith: ".com", storeOriginal: true }
//
// Замена без сохранения оригинала (просто заменить, не трекать):
//   { prefix: "brand", regex: /\bGoogle\b/gi, replaceWith: "Goog", storeOriginal: false }
//
// Замена города с сохранением:
//   { prefix: "city", regex: /\bMoscow\b/gi, replaceWith: "London", storeOriginal: true }
//
// ============================================================
const CUSTOM_RULES = [
  // Пример 1: заменить "planet" / "Planet" на "jupiter",
  // не захватывая следующий символ (используем lookahead (?=\W|$))
  {
    prefix: "org",
    regex: /\b[pP]lanet(?=\W|$)/g,
    replaceWith: "jupiter",
    storeOriginal: true
  },
  // Пример 2: заменить доменные зоны .ru / .Ru / .rU / .RU на .com
  // Ставим ПОСЛЕ url и mail, чтобы не захватить .ru внутри уже обработанного URL.
  // Но ДО domain, если хотим что порядок — url → mail → zone → domain.
  {
    prefix: "zone",
    regex: /\.[rR][uU]\b/g,
    replaceWith: ".com",
    storeOriginal: true
  }
];


// ============================================================
// Итоговый список правил.
// Стандартные правила идут первыми, пользовательские — после.
// Если нужен другой порядок — переставь вручную здесь.
// ============================================================
const RULES = [...DEFAULT_RULES, ...CUSTOM_RULES];


// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

// Получить активный редактор Obsidian.
// Бросает ошибку, если нет открытой markdown-заметки.
function getEditor(app) {
  const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
  if (!view) throw new Error("Нет активной markdown-заметки");
  return view.editor;
}

// Разбить текст заметки на:
//   body — всё до блока карты замен
//   map  — объект с записями замен, распарсенный из JSON
// Если блока карты нет — возвращает исходный текст как body и пустой map.
function splitDocumentAndMap(text) {
  const start = text.indexOf(MAP_START);
  const end   = text.indexOf(MAP_END);

  if (start === -1 || end === -1 || end < start) {
    return { body: text, map: {} };
  }

  const body   = text.slice(0, start).trimEnd();
  const rawMap = text.slice(start + MAP_START.length, end).trim();

  let map = {};
  try {
    map = rawMap ? JSON.parse(rawMap) : {};
  } catch (e) {
    map = {};
  }

  return { body, map };
}

// Собрать текст заметки обратно:
//   body + блок карты замен в конце.
// Если карта пустая — блок не добавляется, возвращается только body.
function buildDocument(body, map) {
  const hasEntries = Object.keys(map).length > 0;
  if (!hasEntries) return body.trimEnd();

  return (
    body.trimEnd() +
    "\n\n" +
    MAP_START + "\n" +
    JSON.stringify(map, null, 2) + "\n" +
    MAP_END + "\n"
  );
}

// Вычислить следующий номер токена для заданного prefix.
// Например, если в карте уже есть mail_1, mail_2 — вернёт 3.
function nextId(map, prefix) {
  const nums = Object.keys(map)
    .filter(k => k.startsWith(prefix + "_"))
    .map(k => Number(k.split("_").pop()))
    .filter(n => !Number.isNaN(n));

  return (nums.length ? Math.max(...nums) : 0) + 1;
}

// Найти уже существующий токен в карте по исходному значению,
// замене и префиксу. Нужно, чтобы не дублировать токены при
// повторной обфускации одинаковых строк.
function findExistingToken(map, original, replacement, prefix) {
  for (const [key, value] of Object.entries(map)) {
    if (
      value &&
      value.original    === original   &&
      value.replacement === replacement &&
      value.prefix      === prefix
    ) {
      return key;
    }
  }
  return null;
}


// ============================================================
// ЯДРО: применить все правила к тексту
// ============================================================
// Проходит по каждому правилу из RULES и заменяет совпадения.
// Если storeOriginal: true — добавляет запись в карту и ставит токен [[prefix_N]].
// Если storeOriginal: false — просто подставляет replaceWith без записи в карту.
// Уже встречавшиеся значения получают тот же токен (не создаётся дубль).
function applyRules(input, map) {
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.regex, (match) => {
      const replacement = rule.replaceWith ?? match;

      // storeOriginal: false — тихая замена без карты
      if (!rule.storeOriginal) {
        return replacement;
      }

      // Проверяем, не обфусцировали ли мы это же значение раньше
      const existingKey = findExistingToken(map, match, replacement, rule.prefix);
      if (existingKey) {
        return `[[${existingKey}]]`;
      }

      // Новое совпадение — создаём запись в карте
      const id = `${rule.prefix}_${nextId(map, rule.prefix)}`;
      map[id] = {
        original:    match,
        replacement: replacement,
        prefix:      rule.prefix
      };

      return `[[${id}]]`;
    });
  }

  return { text, map };
}

// ============================================================
// ЯДРО: восстановить текст из карты
// ============================================================
// Ищет все [[prefix_N]] токены в тексте и заменяет их
// на исходные значения из карты замен.
function restoreFromMap(input, map) {
  return input.replace(/\[\[([a-zA-Z]+_\d+)\]\]/g, (full, key) => {
    const entry = map[key];
    if (!entry) return full; // если токен не найден в карте — оставляем как есть
    return entry.original ?? full;
  });
}


// ============================================================
// КОМАНДА: обфусцировать выделенный текст
// ============================================================
// 1. Читает весь текст заметки и парсит карту замен.
// 2. Применяет правила к выделенному тексту.
// 3. Заменяет выделение обфусцированной версией.
// 4. Перезаписывает заметку с обновлённой картой замен внизу.
async function obfuscateSelection(params) {
  const { app } = params;
  const editor = getEditor(app);

  const fullText = editor.getValue();
  const selection = editor.getSelection();

  if (!selection) {
    new obsidian.Notice("Сначала выдели текст");
    return;
  }

  const { map } = splitDocumentAndMap(fullText);
  const { text: obfuscated, map: updatedMap } = applyRules(selection, map);

  editor.replaceSelection(obfuscated);

  // После replaceSelection текст заметки изменился — перечитываем body
  const currentText = editor.getValue();
  const { body } = splitDocumentAndMap(currentText);
  editor.setValue(buildDocument(body, updatedMap));

  new obsidian.Notice("Обфускация выполнена");
}

// ============================================================
// КОМАНДА: восстановить выделенный текст из карты замен
// ============================================================
// 1. Читает карту замен из конца заметки.
// 2. Заменяет все [[token_N]] в выделении на исходные значения.
// 3. Обновляет заметку (карта замен сохраняется для других токенов).
async function restoreSelection(params) {
  const { app } = params;
  const editor = getEditor(app);

  const fullText = editor.getValue();
  const selection = editor.getSelection();

  if (!selection) {
    new obsidian.Notice("Сначала выдели текст с токенами");
    return;
  }

  const { map } = splitDocumentAndMap(fullText);
  const restored = restoreFromMap(selection, map);

  editor.replaceSelection(restored);

  // Перечитываем body после изменения и пересобираем документ
  const currentText = editor.getValue();
  const { body } = splitDocumentAndMap(currentText);
  editor.setValue(buildDocument(body, map));

  new obsidian.Notice("Восстановление выполнено");
}


// ============================================================
// ЭКСПОРТ для QuickAdd
// QuickAdd видит эти функции как отдельные команды.
// При добавлении User Script в макрос QuickAdd спросит,
// какой export использовать — выбери нужную функцию.
// ============================================================
module.exports = {
  obfuscateSelection,
  restoreSelection
};
