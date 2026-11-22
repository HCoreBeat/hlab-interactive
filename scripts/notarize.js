'use strict';
/**
 * Hook afterSign para electron-builder.
 * En Windows no hay notarización (eso es macOS).
 * Este archivo existe para satisfacer la configuración "afterSign": "scripts/notarize.js"
 * y no romper el build si algún día se añade notarización real.
 */
module.exports = async function (_context) {
  // No-op en Windows. Si se compila en macOS, aquí iría la notarización con notarytool.
  return;
};