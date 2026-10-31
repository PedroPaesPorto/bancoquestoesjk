// Funções pequenas usadas por vários módulos.

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

// Cria um elemento com texto seguro (nunca interpreta HTML vindo do banco).
export function el(tag, classes = "", texto = "") {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (texto) e.textContent = texto;
  return e;
}

export function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function formatarData(ts) {
  if (!ts || typeof ts.toDate !== "function") return "agora há pouco";
  return ts.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function rotuloCargo(cargo) {
  return cargo === "supervisor" ? "Supervisor(a)" : "Professor(a)";
}
