import { normalizar } from "./util.js";

function palavras(texto) {
  return new Set(
    normalizar(texto)
      .replace(/\\[()[\]]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 || /\d/.test(w))
  );
}

// 0 a 1. Perto de 1 significa que os enunciados são praticamente o mesmo texto.
export function similaridade(a, b) {
  const A = palavras(a);
  const B = palavras(b);
  if (A.size === 0 || B.size === 0) return 0;
  if (Math.min(A.size, B.size) < 4) {
    return normalizar(a).replace(/\s+/g, " ").trim() === normalizar(b).replace(/\s+/g, " ").trim() ? 1 : 0;
  }
  let comum = 0;
  A.forEach((w) => { if (B.has(w)) comum++; });
  return comum / (A.size + B.size - comum);
}
