import { $, el } from "./util.js";
import { desenharQuestao } from "./rico.js";
import { resolverQuestao } from "./prova-render.js";
import { chamarIA } from "./ia.js";
import { iaConfigurada } from "./ia-config.js";

const ROTULOS = {
  tea: "TEA (Transtorno do Espectro Autista)",
  nao_leitor: "Aluno não leitor ou leitor iniciante"
};

export function iniciarAdaptar(ctx) {
  const area = document.getElementById("area-adaptar");
  if (!area) return { abrir() {}, limpar() {} };

  let original = null;     // documento da questão
  let resolvida = null;    // questão com imagens e apoio já carregados
  let resultado = null;    // adaptação devolvida pela IA
  let modoUsado = "tea";

  area.innerHTML = `
    <h1 class="text-2xl font-bold sm:text-3xl">Adaptar com IA</h1>
    <p class="mt-1 text-[#33475B]">A IA propõe uma versão adaptada. Você revisa, corrige e salva como uma nova questão, que passa pela validação normal.</p>

    <div id="ad-aviso-config" class="mt-4 hidden rounded-xl border-2 border-marca bg-[#FFF6DB] p-4 text-sm">
      <strong>A IA ainda não foi configurada.</strong>
      Abra <code>js/ia-config.js</code> e cole o endereço do seu projeto no Vercel.
    </div>

    <div id="ad-vazio" class="mt-5 rounded-xl border border-dashed border-[#9FB0BE] bg-white p-6">
      <p class="font-bold">Nenhuma questão escolhida.</p>
      <p class="mt-1 text-[#33475B]">Abra o Banco de questões e toque em “Adaptar com IA” na questão que você quer adaptar.</p>
      <a href="#banco" class="btn mt-4 !w-auto">Ir para o Banco de questões</a>
    </div>

    <div id="ad-conteudo" class="hidden">
      <section class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <h2 class="text-lg font-bold">Questão original</h2>
        <p id="ad-origem" class="text-sm text-[#4B5C6B]"></p>
        <div id="ad-original" class="mt-3"></div>
      </section>

      <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Tipo de adaptação</legend>
        <div class="mt-2 space-y-3">
          <label class="flex items-start gap-3">
            <input type="radio" name="ad-modo" value="tea" class="mt-1 h-5 w-5 accent-[#0F6B6B]" checked>
            <span><strong>TEA.</strong> Linguagem literal e direta, sem metáforas nem duplo sentido, com o enunciado em etapas curtas.</span>
          </label>
          <label class="flex items-start gap-3">
            <input type="radio" name="ad-modo" value="nao_leitor" class="mt-1 h-5 w-5 accent-[#0F6B6B]">
            <span><strong>Não leitor ou leitor iniciante.</strong> Palavras simples e frases curtas para um adulto ler em voz alta, com sugestões de imagens de apoio.</span>
          </label>
          <label id="ad-reduzir-caixa" class="flex items-start gap-3 border-t border-[#E3E9EE] pt-3">
            <input id="ad-reduzir" type="checkbox" class="mt-1 h-5 w-5 accent-[#0F6B6B]">
            <span><strong>Reduzir o número de alternativas.</strong> Mantém a correta e as mais plausíveis. Ajuda a diminuir distratores.</span>
          </label>
        </div>
        <p class="mt-4 text-sm text-[#4B5C6B]">A IA pode errar. Revise tudo antes de usar. Não escreva nomes de alunos na questão.</p>
        <p id="ad-erro" class="mt-3 hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>
        <button type="button" id="ad-gerar" class="btn mt-4 sm:!w-auto sm:min-w-[14rem]">Gerar adaptação</button>
      </fieldset>

      <section id="ad-resultado" class="mt-5 hidden rounded-xl border-2 border-petroleo bg-white p-4 sm:p-5" aria-live="polite">
        <h2 id="ad-resultado-titulo" class="text-lg font-bold"></h2>
        <div id="ad-adaptada" class="mt-3"></div>

        <div id="ad-mudancas-caixa" class="mt-4 hidden">
          <h3 class="font-bold">O que mudou</h3>
          <ul id="ad-mudancas" class="mt-1 list-disc space-y-1 pl-5"></ul>
        </div>
        <div id="ad-visuais-caixa" class="mt-4 hidden">
          <h3 class="font-bold">Suportes visuais sugeridos</h3>
          <ul id="ad-visuais" class="mt-1 list-disc space-y-1 pl-5"></ul>
        </div>
        <div id="ad-mediador-caixa" class="mt-4 hidden">
          <h3 class="font-bold">Orientação para quem aplica a prova</h3>
          <p id="ad-mediador" class="mt-1 whitespace-pre-wrap"></p>
        </div>

        <div class="mt-5 flex flex-col gap-3 sm:flex-row">
          <button type="button" id="ad-usar" class="btn sm:!w-auto">Revisar e salvar como nova versão</button>
          <button type="button" id="ad-refazer" class="rounded-[10px] border-2 border-[#9FB0BE] px-5 py-3 font-bold text-[#33475B] hover:bg-giz">Gerar de novo</button>
        </div>
      </section>
    </div>
  `;

  if (!iaConfigurada) $("#ad-aviso-config", area).classList.remove("hidden");

  function mostrarErro(texto) {
    const caixa = $("#ad-erro", area);
    caixa.textContent = texto || "";
    caixa.classList.toggle("hidden", !texto);
  }

  function modoEscolhido() {
    const marcado = area.querySelector('input[name="ad-modo"]:checked');
    return marcado ? marcado.value : "tea";
  }

  function montarPedido() {
    const r = resolvida;
    return {
      modo: modoEscolhido(),
      reduzirAlternativas: $("#ad-reduzir", area).checked,
      questao: {
        tipo: original.tipo,
        disciplina: original.disciplina,
        ano: original.ano,
        enunciado: original.enunciado,
        gabarito: original.gabarito,
        justificativa: original.justificativa,
        alternativas: (r.alternativas || []).map((alt) => ({
          letra: alt.letra,
          texto: alt.texto || "",
          imagemDescricao: alt.imagem ? alt.imagem.alt || "" : ""
        })),
        imagensDoEnunciado: (r.imagens || []).map((img) => img.alt || ""),
        textoDeApoio: r.apoio ? { titulo: r.apoio.titulo || "", texto: r.apoio.texto || "" } : null
      }
    };
  }

  function preencherLista(idLista, idCaixa, itens) {
    const lista = $(idLista, area);
    lista.replaceChildren();
    itens.forEach((texto) => lista.appendChild(el("li", "", texto)));
    $(idCaixa, area).classList.toggle("hidden", itens.length === 0);
  }

  function mostrarResultado() {
    const r = resolvida;
    $("#ad-resultado-titulo", area).textContent = `Versão adaptada: ${ROTULOS[modoUsado]}`;

    desenharQuestao($("#ad-adaptada", area), {
      apoio: r.apoio,
      enunciado: resultado.enunciado,
      imagens: r.imagens,
      tipo: original.tipo,
      alternativas: (resultado.alternativas || []).map((alt) => {
        const base = (r.alternativas || []).find((o) => o.letra === alt.origemLetra);
        return { letra: alt.letra, texto: alt.texto, imagem: base ? base.imagem : null };
      }),
      gabarito: resultado.gabarito,
      justificativa: resultado.justificativa,
      mostrarGabarito: true
    });

    preencherLista("#ad-mudancas", "#ad-mudancas-caixa", resultado.mudancas || []);
    preencherLista("#ad-visuais", "#ad-visuais-caixa",
      (resultado.suportesVisuais || []).map((s) => `${s.onde}: ${s.descricao}`));

    const mediador = (resultado.orientacaoAoMediador || "").trim();
    $("#ad-mediador", area).textContent = mediador;
    $("#ad-mediador-caixa", area).classList.toggle("hidden", !mediador);

    $("#ad-resultado", area).classList.remove("hidden");
    $("#ad-resultado", area).scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function gerar() {
    mostrarErro("");
    if (!original || !resolvida) return;

    const botao = $("#ad-gerar", area);
    botao.disabled = true;
    botao.textContent = "A IA está trabalhando… pode levar até 30 segundos";
    try {
      const pedido = montarPedido();
      const resposta = await chamarIA(ctx, "adaptar", pedido);
      resultado = resposta.adaptacao;
      modoUsado = pedido.modo;
      mostrarResultado();
      await ctx.registrarAuditoria("adaptacao_gerada_ia", {
        questaoId: original.id,
        modo: pedido.modo,
        reduziu: pedido.reduzirAlternativas
      });
    } catch (e) {
      mostrarErro(e.message || "Não foi possível gerar a adaptação.");
    } finally {
      botao.disabled = false;
      botao.textContent = "Gerar adaptação";
    }
  }

  async function abrir(questao) {
    original = questao;
    resultado = null;
    resolvida = null;
    mostrarErro("");
    $("#ad-resultado", area).classList.add("hidden");
    $("#ad-vazio", area).classList.add("hidden");
    $("#ad-conteudo", area).classList.remove("hidden");
    $("#ad-origem", area).textContent = `${questao.disciplina}, ${questao.ano}, ${questao.bimestre}º bimestre. ${questao.assunto || ""}`;
    $("#ad-reduzir-caixa", area).classList.toggle("hidden", questao.tipo !== "multipla_escolha");
    $("#ad-reduzir", area).checked = false;

    const quadro = $("#ad-original", area);
    quadro.replaceChildren(el("p", "text-sm text-[#4B5C6B]", "Carregando a questão…"));
    try {
      resolvida = await resolverQuestao(ctx.db, questao);
      desenharQuestao(quadro, { ...resolvida, mostrarGabarito: true });
    } catch (e) {
      console.error(e);
      quadro.replaceChildren(el("p", "font-bold text-alerta", "Não foi possível carregar a questão."));
    }
  }

  function limpar() {
    original = null;
    resolvida = null;
    resultado = null;
    $("#ad-conteudo", area).classList.add("hidden");
    $("#ad-vazio", area).classList.remove("hidden");
    $("#ad-resultado", area).classList.add("hidden");
  }

  $("#ad-gerar", area).addEventListener("click", gerar);
  $("#ad-refazer", area).addEventListener("click", gerar);
  $("#ad-usar", area).addEventListener("click", () => {
    if (!original || !resultado) return;
    ctx.aoUsarVersao(original, resultado, {
      tipo: modoUsado,
      suportesVisuais: resultado.suportesVisuais || [],
      orientacao: (resultado.orientacaoAoMediador || "").trim()
    });
  });

  return { abrir, limpar };
}
