'use strict';

/**
 * Preferencias de modelo por sesión (modelo + esfuerzo de razonamiento).
 * Se guardan en localStorage para que ni una recarga de sesiones ni el sync
 * previo al envío las reviertan al valor que tenga el servidor.
 */

const KEY = 'ocv.modelBySession';

export const modelPins = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
})();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(modelPins)); } catch { /* sin almacenamiento */ }
}

/** `reference`: { providerID, modelID, variant? }. Sin `variant` conserva el anterior si es el mismo modelo. */
export function pinModel(sessionID, reference) {
  const previous = modelPins[sessionID];
  const same = previous && previous.providerID === reference.providerID && previous.modelID === reference.modelID;
  const variant = reference.variant !== undefined ? reference.variant : (same ? previous.variant || '' : '');
  modelPins[sessionID] = { providerID: reference.providerID, modelID: reference.modelID, variant };
  save();
}

export function variantOf(sessionID) {
  return modelPins[sessionID]?.variant || '';
}

/** Esfuerzos disponibles de un modelo: sus `variants` o, si razona, los habituales. */
export function variantsOf(model) {
  const raw = model?.variants;
  let names = [];
  if (Array.isArray(raw)) names = raw.map((item) => (typeof item === 'string' ? item : item?.id || item?.name)).filter(Boolean);
  else if (raw && typeof raw === 'object') names = Object.keys(raw);
  if (names.length > 0) return { names, declared: true };
  if (model?.capabilities?.reasoning || model?.reasoning) return { names: ['low', 'medium', 'high'], declared: false };
  return { names: [], declared: false };
}

const LABELS = {
  none: 'Ninguno', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo',
};
export function variantLabel(name) {
  return name ? (LABELS[name] || name) : 'Auto';
}
