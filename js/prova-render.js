import { el } from "./util.js";
import { renderRico, desenharImagem } from "./rico.js";
import { obterImagem, obterApoio } from "./midia.js";

const paraImagem = (img) => ({ dataUrl: img.dataUrl, alt: img.alt });

export function formatarValor(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function dataBR(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
}

// Busca imagens e texto de apoio de uma questão e devolve tudo pronto para desenhar.
export async function resolverQuestao(db, q) {
  const resolver = async (ids) =>
    (await Promise.all((ids || []).map((id) => obterImagem(db, id)))).filter(Boolean).map(paraImagem);

  const apoioDoc = q.textoApoioId ? await obterApoio(db, q.textoApoioId) : null;
  return {
    apoio: apoioDoc
      ? { titulo: apoioDoc.titulo, fonte: apoioDoc.fonte, texto: apoioDoc.texto, imagens: await resolver(apoioDoc.imagens) }
      : null,
    enunciado: q.enunciado,
    imagens: await resolver(q.enunciadoImagens),
    tipo: q.tipo,
    alternativas: await Promise.all((q.alternativas || []).map(async (alt) => ({
      letra: alt.letra,
      texto: alt.texto,
      imagem: alt.imagemId ? ((await resolver([alt.imagemId]))[0] || null) : null
    }))),
    gabarito: q.gabarito,
    justificativa: q.justificativa
  };
}

function campo(rotulo, valor, classes = "flex-1") {
  const caixa = el("div", `flex items-end gap-1 ${classes}`);
  caixa.appendChild(el("span", "whitespace-nowrap font-bold", `${rotulo}:`));
  caixa.appendChild(el("span", "min-h-[1.3em] flex-1 border-b border-black px-1", valor || ""));
  return caixa;
}

function desenharCabecalho(destino, { escola, cabecalho }, tituloExtra) {
  const cab = el("header", "mb-4 border-b-2 border-black pb-3");
  cab.appendChild(el("p", "text-center text-lg font-bold", escola.nome));
  if (escola.cidade) cab.appendChild(el("p", "text-center text-sm", escola.cidade));
  cab.appendChild(el("p", "mt-1 text-center font-bold", tituloExtra ? `${tituloExtra} — ${cabecalho.titulo}` : cabecalho.titulo));

  if (!tituloExtra) {
    const l1 = el("div", "mt-3 flex flex-wrap gap-x-4 gap-y-3");
    l1.appendChild(campo("Aluno(a)", "", "flex-[3] min-w-[14rem]"));
    l1.appendChild(campo("Turma", cabecalho.turma, "w-40"));
    cab.appendChild(l1);

    const l2 = el("div", "mt-3 flex flex-wrap gap-x-4 gap-y-3");
    l2.appendChild(campo("Professor(a)", cabecalho.professor, "flex-[2] min-w-[12rem]"));
    l2.appendChild(campo("Data", dataBR(cabecalho.data), "w-44"));
    l2.appendChild(campo("Valor", formatarValor(cabecalho.valorTotal), "w-28"));
    l2.appendChild(campo("Nota", "", "w-28"));
    cab.appendChild(l2);
  }

  const partes = [cabecalho.disciplina, cabecalho.ano, cabecalho.bimestre ? `${cabecalho.bimestre}º bimestre` : ""].filter(Boolean);
  cab.appendChild(el("p", "mt-2 text-sm", partes.join(" • ")));
  destino.appendChild(cab);
}

// ---------- Prova do aluno ----------
export async function renderizarProva(destino, dados) {
  const { db, itens, config, cabecalho } = dados;
  destino.replaceChildren();
  desenharCabecalho(destino, dados);

  if (cabecalho.instrucoes) {
    const caixa = el("div", "mb-5 rounded border border-black p-3 text-sm");
    caixa.appendChild(el("strong", "", "Instruções: "));
    caixa.appendChild(el("span", "whitespace-pre-wrap", cabecalho.instrucoes));
    destino.appendChild(caixa);
  }

  const resolvidas = await Promise.all(itens.map((item) => resolverQuestao(db, item.q)));
  let apoioAnterior = null;

  itens.forEach((item, i) => {
    const r = resolvidas[i];
    const apoioId = item.q.textoApoioId || null;

    if (r.apoio && apoioId !== apoioAnterior) {
      let fim = i;
      while (fim + 1 < itens.length && itens[fim + 1].q.textoApoioId === apoioId) fim++;
      if (fim > i) {
        destino.appendChild(el("p", "mb-1 mt-2 text-sm font-bold", `Use o texto abaixo para responder às questões ${i + 1} a ${fim + 1}.`));
      }
      const bloco = el("div", "questao-prova mb-4 border border-black p-3");
      if (r.apoio.titulo) bloco.appendChild(el("p", "font-bold", r.apoio.titulo));
      const texto = el("div", "mt-1 whitespace-pre-wrap");
      renderRico(texto, r.apoio.texto);
      bloco.appendChild(texto);
      (r.apoio.imagens || []).forEach((img) => desenharImagem(bloco, img));
      if (r.apoio.fonte) bloco.appendChild(el("p", "mt-1 text-sm", `Fonte: ${r.apoio.fonte}`));
      destino.appendChild(bloco);
    }
    apoioAnterior = apoioId;

    const secao = el("section", "questao-prova mb-5");
    const titulo = el("p", "mb-1");
    titulo.appendChild(el("strong", "", `${i + 1}. `));
    if (item.valor > 0) {
      titulo.appendChild(el("span", "text-sm", `(${formatarValor(item.valor)} ${item.valor === 1 ? "ponto" : "pontos"}) `));
    }
    const enunciado = el("span", "whitespace-pre-wrap");
    renderRico(enunciado, r.enunciado);
    titulo.appendChild(enunciado);
    secao.appendChild(titulo);
    (r.imagens || []).forEach((img) => desenharImagem(secao, img));

    if (r.tipo === "multipla_escolha") {
      const lista = el("div", "mt-2 space-y-1");
      r.alternativas.forEach((alt) => {
        const linha = el("div", "alternativa flex gap-2");
        linha.appendChild(el("span", "font-bold", `${alt.letra})`));
        const corpo = el("div", "flex-1");
        const txt = el("span", "whitespace-pre-wrap");
        renderRico(txt, alt.texto);
        corpo.appendChild(txt);
        if (alt.imagem) desenharImagem(corpo, alt.imagem);
        linha.appendChild(corpo);
        lista.appendChild(linha);
      });
      secao.appendChild(lista);
    } else {
      const linhas = Number(config.linhas) || 0;
      const espaco = el("div", "mt-2");
      for (let n = 0; n < linhas; n++) espaco.appendChild(el("div", "h-8 border-b border-black"));
      secao.appendChild(espaco);
    }
    destino.appendChild(secao);
  });
}

// ---------- Gabarito (folha do professor) ----------
export async function renderizarGabarito(destino, dados) {
  const { itens } = dados;
  destino.replaceChildren();
  desenharCabecalho(destino, dados, "GABARITO");

  const resumo = el("div", "mb-5 flex flex-wrap gap-2");
  itens.forEach((item, i) => {
    const resposta = item.q.tipo === "multipla_escolha" ? item.q.gabarito : "disc.";
    const caixa = el("div", "rounded border border-black px-3 py-1 font-bold", `${i + 1}  ${resposta}`);
    resumo.appendChild(caixa);
  });
  destino.appendChild(resumo);

  itens.forEach((item, i) => {
    const q = item.q;
    const secao = el("section", "questao-prova mb-3 text-sm");
    secao.appendChild(el("p", "font-bold", `Questão ${i + 1} — ${q.assunto || ""}`));

    if (q.tipo === "multipla_escolha") {
      secao.appendChild(el("p", "", `Resposta correta: ${q.gabarito}`));
    } else {
      const esperada = el("p", "whitespace-pre-wrap");
      esperada.appendChild(el("strong", "", "Resposta esperada: "));
      const texto = el("span");
      renderRico(texto, q.gabarito);
      esperada.appendChild(texto);
      secao.appendChild(esperada);
    }

    if (q.justificativa) {
      const just = el("p", "whitespace-pre-wrap");
      just.appendChild(el("strong", "", "Justificativa: "));
      const texto = el("span");
      renderRico(texto, q.justificativa);
      just.appendChild(texto);
      secao.appendChild(just);
    }
    destino.appendChild(secao);
  });
}
