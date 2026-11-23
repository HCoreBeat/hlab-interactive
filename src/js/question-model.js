/**
 * Modelo compartido de las preguntas del agente entre generaciones de la API.
 *
 * opencode 2.2.x: evento `question.asked` (id `que_…`) y rutas
 *   /api/session/{sessionID}/question/{requestID}/reply
 *
 * opencode 2.3.x: la herramienta `question` crea un Form con
 *   metadata.kind === 'question', título "Questions" y campos `q0`, `q1`, …
 *   (type `string` para una sola respuesta y `multiselect` para varias).
 *   La respuesta va a /api/session/{sessionID}/form/{formID}/reply con
 *   cuerpo `{ answer: { q0: "Etiqueta", q1: ["A", "B"] } }`.
 *   El evento `form.created` trae `{ form }` y `form.replied`/`form.cancelled`
 *   traen `{ id, sessionID }`.
 */

const TOOL_CALL_ID = /^(?:call|tool):/i;

/** IDs de llamada de herramienta nunca son IDs de solicitud respondibles. */
export function usableID(value) {
  return typeof value === 'string' && value.trim().length > 0 && !TOOL_CALL_ID.test(value);
}

/**
 * Elige el ID real de una lista de candidatos. Prefiere el prefijo canónico
 * (`que`/`per`), pero acepta otros ids válidos: los servidores demo y algunas
 * versiones usan prefijos distintos (`qst_`, por ejemplo).
 */
export function pickRequestID(candidates, prefix) {
  const valid = candidates.filter(usableID);
  return valid.find((id) => id.toLowerCase().startsWith(prefix)) || valid[0] || null;
}

/** ¿Es este form (o el payload de un evento) una pregunta del agente? */
export function isQuestionForm(value) {
  const form = value?.form || value;
  if (!form || typeof form !== 'object') return false;
  if (!usableID(form.id)) return false;
  if (!Array.isArray(form.fields) || form.fields.length === 0) return false;
  return form.metadata?.kind === 'question'
    || String(form.title || '').toLowerCase() === 'questions';
}

/** Convierte un Form de opencode 2.3.x a la tarjeta de pregunta de la app. */
export function questionFromForm(value, fallbackSession = null) {
  const form = value?.form || value;
  if (!isQuestionForm(form)) return null;
  const fields = form.fields;
  const tool = form.metadata?.tool || {};
  const questions = fields.map((field, index) => ({
    header: field.title || null,
    question: field.description || field.title || `Pregunta ${index + 1}`,
    options: (field.options || []).map((option) => ({
      label: option.label ?? option.value,
      value: option.value ?? option.label,
      description: option.description || '',
    })),
    multiple: field.type === 'multiselect',
    custom: field.custom !== false,
    fieldKey: field.key || `q${index}`,
    type: field.type || (field.type === 'multiselect' ? 'multiselect' : 'string'),
  }));
  if (questions.length === 0) return null;
  return {
    id: form.id,
    sessionID: form.sessionID || fallbackSession,
    questions,
    tool: 'question',
    kind: 'form',
    formID: form.id,
    fields,
    title: form.title,
    metadata: form.metadata || {},
    assistantMessageID: tool.messageID || null,
    synthetic: false,
  };
}

/**
 * Cuerpo que espera `POST /form/{formID}/reply`.
 * `answers` es un array de etiquetas por pregunta, en el mismo orden que
 * `item.questions`. Los campos `string` llevan un valor escalar y los
 * `multiselect` un array, tal como valida el servidor.
 */
export function formAnswerBody(item, answers) {
  const fields = item.fields || (item.questions || []).map((question, index) => ({
    key: question.fieldKey || `q${index}`,
    type: question.multiple ? 'multiselect' : 'string',
  }));
  const answer = {};
  fields.forEach((field, index) => {
    const key = field.key || `q${index}`;
    const values = [...(answers[index] || [])];
    answer[key] = field.type === 'multiselect' ? values : (values[0] ?? '');
  });
  return { answer };
}
