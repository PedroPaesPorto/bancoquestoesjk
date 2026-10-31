import { el } from "./util.js";

// Texto rico = texto comum + fórmulas.
//   \( ... \)  fórmula no meio do texto
//   \[ ... \]  fórmula em destaque
//   \ce{H2O}   química (dentro de uma fórmula)
// Usamos \( \) em vez de $ porque $ aparece em problemas com dinheiro (R$ 5,00).

const PADRAO_FORMULA = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;

function desenharFormula(alvo, expressao, destaque, original) {
  if (window.katex) {
    try {
      window.katex.render(expressao, alvo, {
        displayMode: destaque,
        throwOnError: false,
        trust: false,
        strict: "ignore"
      });
      return;
    } catch (e) {
      console.warn("Fórmula inválida:", e);
    }
  }
  alvo.textContent = original;
}

export function renderRico(destino, texto) {
  destino.replaceChildren();
  const fonte = String(texto || "");
  let ultimo = 0;
  let achado;
  PADRAO_FORMULA.lastIndex = 0;

  while ((achado = PADRAO_FORMULA.exec(fonte)) !== null) {
    if (achado.index > ultimo) {
      destino.appendChild(document.createTextNode(fonte.slice(ultimo, achado.index)));
    }
    const destaque = achado[1] !== undefined;
    const expressao = destaque ? achado[1] : achado[2];
    const span = document.createElement("span");
    if (destaque) span.className = "block my-2 overflow-x-auto";
    desenharFormula(span, expressao, destaque, achado[0]);
    destino.appendChild(span);
    ultimo = PADRAO_FORMULA.lastIndex;
  }

  if (ultimo < fonte.length) {
    destino.appendChild(document.createTextNode(fonte.slice(ultimo)));
  }
}

export function desenharImagem(destino, imagem) {
  const figura = document.createElement("img");
  figura.src = imagem.dataUrl;
  figura.alt = imagem.alt || "";
  figura.className = "my-2 max-h-72 max-w-full rounded border border-[#D5DDE4] bg-white object-contain";
  destino.appendChild(figura);
}

// Desenha uma questão completa (usada na prévia do formulário e no banco).
// q = {
//   apoio: { titulo, fonte, texto, imagens: [{dataUrl, alt}] } | null,
//   enunciado, imagens: [{dataUrl, alt}],
//   tipo, alternativas: [{ letra, texto, imagem: {dataUrl, alt} | null }],
//   gabarito, justificativa, mostrarGabarito
// }
export function desenharQuestao(destino, q) {
  destino.replaceChildren();

  if (q.apoio) {
    const bloco = el("div", "mb-4 rounded-lg border-l-4 border-petroleo bg-giz p-3");
    if (q.apoio.titulo) bloco.appendChild(el("p", "font-bold", q.apoio.titulo));
    const texto = el("div", "mt-1 whitespace-pre-wrap");
    renderRico(texto, q.apoio.texto);
    bloco.appendChild(texto);
    (q.apoio.imagens || []).forEach((img) => desenharImagem(bloco, img));
    if (q.apoio.fonte) bloco.appendChild(el("p", "mt-1 text-sm text-[#4B5C6B]", `Fonte: ${q.apoio.fonte}`));
    destino.appendChild(bloco);
  }

  const enunciado = el("div", "whitespace-pre-wrap");
  renderRico(enunciado, q.enunciado);
  destino.appendChild(enunciado);
  (q.imagens || []).forEach((img) => desenharImagem(destino, img));

  if (q.tipo === "multipla_escolha") {
    const lista = el("ul", "mt-3 space-y-1");
    (q.alternativas || []).forEach((alt) => {
      const correta = q.mostrarGabarito && alt.letra === q.gabarito;
      const item = el("li", correta ? "rounded-lg bg-petroleo-claro p-2 font-bold" : "p-2");
      item.appendChild(document.createTextNode(`${alt.letra}) `));
      const texto = el("span", "whitespace-pre-wrap");
      renderRico(texto, alt.texto);
      item.appendChild(texto);
      if (alt.imagem) desenharImagem(item, alt.imagem);
      if (correta) item.appendChild(document.createTextNode(" (correta)"));
      lista.appendChild(item);
    });
    destino.appendChild(lista);
  } else if (q.mostrarGabarito && q.gabarito) {
    const resposta = el("div", "mt-3 rounded-lg bg-petroleo-claro p-3");
    resposta.appendChild(el("strong", "", "Resposta esperada: "));
    const texto = el("span", "whitespace-pre-wrap");
    renderRico(texto, q.gabarito);
    resposta.appendChild(texto);
    destino.appendChild(resposta);
  }

  if (q.mostrarGabarito && q.justificativa) {
    const just = el("div", "mt-3 whitespace-pre-wrap");
    just.appendChild(el("strong", "", "Justificativa: "));
    const texto = el("span");
    renderRico(texto, q.justificativa);
    just.appendChild(texto);
    destino.appendChild(just);
  }
}
