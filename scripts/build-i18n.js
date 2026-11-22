'use strict';

/**
 * Genera `src/js/i18n/catalogs.js` a partir de los JSON de traducción.
 * Electron carga los módulos directamente desde file://, donde un `import`
 * estático de JSON no es fiable; este paso convierte los catálogos en JS.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'src', 'i18n');
const outputDir = path.join(root, 'src', 'js', 'i18n');
const outputFile = path.join(outputDir, 'catalogs.js');

fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const en = read('en.json') || {};
let es = read('es.json');
if (!es) {
  // Español = claves originales; se genera también el JSON para editarlo.
  es = Object.fromEntries(Object.keys(en).map((key) => [key, key]));
  fs.writeFileSync(path.join(sourceDir, 'es.json'), `${JSON.stringify(es, null, 2)}\n`, 'utf8');
}

const body = `/* GENERADO por scripts/build-i18n.js — no editar a mano. */\nexport const catalogs = ${JSON.stringify({ es, en }, null, 2)};\n`;
fs.writeFileSync(outputFile, body, 'utf8');
console.log(`[i18n] ${Object.keys(en).length} textosgenerados (es, en)`);
