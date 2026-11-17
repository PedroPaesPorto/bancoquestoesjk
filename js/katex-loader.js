// Carrega o leitor de fórmulas (KaTeX).
// Primeiro tenta a cópia que fica no próprio site (pasta vendor/katex).
// Se a pasta não existir ou falhar, busca na internet (jsDelivr). Assim o site funciona nos dois casos.

const LOCAL = "vendor/katex/";
const CDN = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
const TEMPO_LIMITE_MS = 10000;

function carregarScript(url) {
  return new Promise((resolver, rejeitar) => {
    const s = document.createElement("script");
    const limite = setTimeout(() => { s.remove(); rejeitar(new Error(`Tempo esgotado: ${url}`)); }, TEMPO_LIMITE_MS);
    s.src = url;
    s.onload = () => { clearTimeout(limite); resolver(); };
    s.onerror = () => { clearTimeout(limite); s.remove(); rejeitar(new Error(`Não carregou: ${url}`)); };
    document.head.appendChild(s);
  });
}

async function comReserva(caminho) {
  try {
    await carregarScript(LOCAL + caminho);
  } catch (e) {
    await carregarScript(CDN + caminho);
  }
}

// Devolve true se as fórmulas (e a química) estão disponíveis.
export async function garantirKatex() {
  try {
    if (!window.katex) await comReserva("katex.min.js");
    await comReserva("contrib/mhchem.min.js");
    return true;
  } catch (e) {
    console.warn("Não foi possível carregar o leitor de fórmulas:", e);
    return false;
  }
}
