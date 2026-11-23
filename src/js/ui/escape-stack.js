'use strict';

/** Pila de面板/overlays que quieren cerrarse antes que el panel lateral. */
const stack = [];

export function pushEscape(close) {
  stack.push(close);
  return () => {
    const index = stack.indexOf(close);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** Cierra el nivel más alto; devuelve true si alguien lo gestionó. */
export function closeTopEscape() {
  while (stack.length > 0) {
    const close = stack.pop();
    if (close()) return true;
  }
  return false;
}
