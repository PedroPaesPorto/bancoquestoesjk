import {
  addDoc, collection, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SEGMENTOS, BIMESTRES, TIPOS, DIFICULDADES, LETRAS } from "./curriculo.js";
import { $, el } from "./util.js";
import { desenharQuestao } from "./rico.js";
import {
  criarSeletorImagens, persistirImagens, obterImagem, obterApoio, listarApoios, guardarApoio
} from "./midia.js";

const NOVO_APOIO = "__novo__";

// Botões que inserem fórmulas. O "|" marca onde o cursor fica.
const BOTOES_FORMULA = [
  ["Fórmula", "\\(|\\)"],
  ["Em destaque", "\\[|\\]"],
  ["Fração", "\\(\\frac{|}{}\\)"],
  ["Raiz", "\\(\\sqrt{|}\\)"],
  ["Potência", "\\(x^{|}\\)"],
  ["Índice", "\\(x_{|}\\)"],
  ["Química", "\\(\\ce{|}\\)"]
];

const DICA_FORMULA = "Fórmulas: \\( ... \\) dentro do texto e \\[ ... \\] em destaque. Química: \\(\\ce{H2O}\\). Os botões abaixo do campo ajudam.";

function inserirModelo(campo, modelo) {
  const [antes, depois] = modelo.split("|");
  const inicio = campo.selectionStart ?? campo.value.length;
  const fim = campo.selectionEnd ?? inicio;
  const selecionado = campo.value.slice(inicio, fim);
  campo.setRangeText(antes + selecionado + depois, inicio, fim, "end");
  const posicao = inicio + antes.length + selecionado.length;
  campo.setSelectionRange(posicao, posicao);
  campo.focus();
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function criarBarraFormulas(campo) {
  const barra = el("div", "mt-2 flex flex-wrap gap-2");
  barra.setAttribute("role", "group");
  barra.setAttribute("aria-label", "Inserir fórmula");
  BOTOES_FORMULA.forEach(([rotulo, modelo]) => {
    const botao = el("button", "rounded-lg border border-[#9FB0BE] bg-white px-3 py-1.5 text-sm font-bold text-[#33475B] hover:bg-giz", rotulo);
    botao.type = "button";
    botao.addEventListener("click", () => inserirModelo(campo, modelo));
    barra.appendChild(botao);
  });
  campo.insertAdjacentElement("afterend", barra);
}

function opcoes(lista, textoVazio) {
  const vazio = `<option value="">${textoVazio}</option>`;
  return vazio + lista.map((item) => `<option value="${item.valor}">${item.rotulo}</option>`).join("");
}

function htmlFormulario() {
  const segmentos = opcoes(
    Object.entries(SEGMENTOS).map(([valor, s]) => ({ valor, rotulo: s.rotulo })),
    "Selecione o segmento"
  );
  const bimestres = opcoes(
    BIMESTRES.map((n) => ({ valor: String(n), rotulo: `${n}º bimestre` })),
    "Selecione o bimestre"
  );
  const tipos = Object.entries(TIPOS)
    .map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`)
    .join("");
  const dificuldades = opcoes(
    Object.entries(DIFICULDADES).map(([valor, rotulo]) => ({ valor, rotulo })),
    "Selecione a dificuldade"
  );

  const alternativas = LETRAS.map((letra) => {
    const opcional = letra === "E" ? " (opcional)" : "";
    return `
      <div class="flex items-start gap-3">
        <input type="radio" name="gabarito-mc" value="${letra}" id="gab-${letra}"
               class="mt-3 h-5 w-5 accent-[#0F6B6B]" aria-label="Marcar a alternativa ${letra} como correta">
        <div class="min-w-0 flex-1">
          <label class="rotulo" for="alt-${letra}">Alternativa ${letra}${opcional}</label>
          <input id="alt-${letra}" type="text" class="campo" autocomplete="off">
          <div id="alt-img-${letra}"></div>
        </div>
      </div>`;
  }).join("");

  return `
    <h1 id="q-titulo" class="text-2xl font-bold sm:text-3xl">Nova questão</h1>
    <p class="mt-1 text-[#33475B]">Toda questão nova fica aguardando validação até o Supervisor aprovar.</p>

    <div id="q-banner" class="mt-4 hidden flex-col gap-2 rounded-xl border-2 border-marca bg-[#FFF6DB] p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <p id="q-banner-texto" class="font-bold"></p>
      <button type="button" id="q-cancelar-edicao"
              class="rounded-[10px] border-2 border-[#9FB0BE] bg-white px-4 py-2 font-bold text-[#33475B]">
        Cancelar
      </button>
    </div>

    <form id="form-questao" class="mt-6 space-y-6" novalidate>

      <fieldset class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Onde a questão se encaixa</legend>
        <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="rotulo" for="q-segmento">Segmento</label>
            <select id="q-segmento" class="campo">${segmentos}</select>
          </div>
          <div>
            <label class="rotulo" for="q-ano">Ano / série</label>
            <select id="q-ano" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
          </div>
          <div>
            <label class="rotulo" for="q-disciplina">Disciplina</label>
            <select id="q-disciplina" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
          </div>
          <div>
            <label class="rotulo" for="q-bimestre">Bimestre</label>
            <select id="q-bimestre" class="campo">${bimestres}</select>
          </div>
          <div class="sm:col-span-2">
            <label class="rotulo" for="q-assunto">Assunto ou eixo temático</label>
            <input id="q-assunto" type="text" class="campo" maxlength="120" placeholder="Ex.: Fotossíntese" autocomplete="off">
          </div>
          <div class="sm:col-span-2">
            <label class="rotulo" for="q-habilidade">Habilidade BNCC ou da matriz estadual (opcional)</label>
            <input id="q-habilidade" type="text" class="campo" maxlength="40" placeholder="Ex.: EF07CI07" autocomplete="off">
          </div>
        </div>
      </fieldset>

      <fieldset class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Tipo e dificuldade</legend>
        <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="rotulo" for="q-tipo">Tipo</label>
            <select id="q-tipo" class="campo">${tipos}</select>
          </div>
          <div>
            <label class="rotulo" for="q-dificuldade">Dificuldade</label>
            <select id="q-dificuldade" class="campo">${dificuldades}</select>
          </div>
        </div>
      </fieldset>

      <fieldset class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Texto de apoio (opcional)</legend>
        <p class="mt-1 text-sm text-[#4B5C6B]">Use quando várias questões partem do mesmo texto, tirinha ou figura. Os textos já cadastrados aparecem para a mesma disciplina e segmento.</p>
        <div class="mt-3">
          <label class="rotulo" for="q-apoio">Texto de apoio</label>
          <select id="q-apoio" class="campo"></select>
        </div>

        <div id="ap-novo" class="mt-4 hidden space-y-4 rounded-lg border border-[#E3E9EE] p-3">
          <div>
            <label class="rotulo" for="ap-titulo">Título do texto de apoio</label>
            <input id="ap-titulo" type="text" class="campo" maxlength="120" autocomplete="off" placeholder="Ex.: Crônica “O ladrão de sonhos”">
          </div>
          <div>
            <label class="rotulo" for="ap-fonte">Fonte ou autoria (opcional)</label>
            <input id="ap-fonte" type="text" class="campo" maxlength="200" autocomplete="off">
          </div>
          <div>
            <label class="rotulo" for="ap-texto">Texto</label>
            <textarea id="ap-texto" rows="6" maxlength="12000" class="campo"></textarea>
          </div>
          <div id="ap-imagens"></div>
        </div>
      </fieldset>

      <fieldset class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Enunciado</legend>
        <div class="mt-2">
          <label class="rotulo" for="q-enunciado">Texto da questão</label>
          <p id="q-dica-formula" class="mb-1 text-sm text-[#4B5C6B]"></p>
          <textarea id="q-enunciado" rows="5" maxlength="4000" class="campo"></textarea>
          <div id="q-enunciado-imagens"></div>
        </div>
      </fieldset>

      <fieldset id="bloco-mc" class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Alternativas e gabarito</legend>
        <p class="mt-1 text-sm text-[#4B5C6B]">Preencha de A a D com texto, imagem ou os dois. Marque o círculo ao lado da alternativa correta.</p>
        <div class="mt-4 space-y-5">${alternativas}</div>
      </fieldset>

      <fieldset id="bloco-disc" class="hidden rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Resposta esperada</legend>
        <div class="mt-2">
          <label class="rotulo" for="q-gabarito-disc">O que a resposta precisa conter</label>
          <textarea id="q-gabarito-disc" rows="4" maxlength="3000" class="campo"></textarea>
        </div>
      </fieldset>

      <fieldset class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Justificativa</legend>
        <div class="mt-2">
          <label class="rotulo" for="q-justificativa">Por que esta é a resposta certa</label>
          <textarea id="q-justificativa" rows="3" maxlength="3000" class="campo"></textarea>
        </div>
      </fieldset>

      <details class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5" open>
        <summary class="cursor-pointer text-lg font-bold">Prévia da questão</summary>
        <div id="q-previa" class="mt-3 text-[#12263A]"></div>
      </details>

      <p id="q-erro" class="hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <button type="button" id="q-limpar"
                class="rounded-[10px] border-2 border-[#9FB0BE] px-5 py-3 font-bold text-[#33475B] hover:bg-white">
          Limpar tudo
        </button>
        <button type="submit" id="q-salvar" class="btn sm:!w-auto sm:min-w-[14rem]">Salvar questão</button>
      </div>

      <p id="q-contador" class="text-sm text-[#4B5C6B]" aria-live="polite"></p>
    </form>
  `;
}

export function iniciarQuestoes(ctx) {
  const area = document.getElementById("area-nova");
  if (!area) return { async editar() {}, async versao() {}, async versaoAdaptada() {} };
  area.innerHTML = htmlFormulario();

  const form = $("#form-questao", area);
  const selSegmento = $("#q-segmento", area);
  const selAno = $("#q-ano", area);
  const selDisciplina = $("#q-disciplina", area);
  const selTipo = $("#q-tipo", area);
  const selApoio = $("#q-apoio", area);
  const erro = $("#q-erro", area);
  const botaoSalvar = $("#q-salvar", area);
  const contador = $("#q-contador", area);

  let salvasNaSessao = 0;
  let modo = "novo"; // "novo" | "editar" | "versao"
  let alvo = null;   // { id } da questão editada ou usada como base da nova versão
  let adaptacaoAtual = null; // { tipo, suportesVisuais, orientacao } quando a versão vem da IA
  let tokenPrevia = 0;
  let temporizadorPrevia = null;

  // ----- Imagens e barras de fórmulas -----
  const seletorEnunciado = criarSeletorImagens($("#q-enunciado-imagens", area), { max: 4, db: ctx.db });
  const seletorApoio = criarSeletorImagens($("#ap-imagens", area), { max: 3, db: ctx.db });
  const seletoresAlt = {};
  LETRAS.forEach((letra) => {
    seletoresAlt[letra] = criarSeletorImagens($(`#alt-img-${letra}`, area), {
      max: 1, rotuloBotao: "Adicionar imagem à alternativa", db: ctx.db
    });
  });

  $("#q-dica-formula", area).textContent = DICA_FORMULA;
  ["#q-enunciado", "#q-justificativa", "#ap-texto", "#q-gabarito-disc"].forEach((id) => {
    criarBarraFormulas($(id, area));
  });

  // ----- Utilidades de tela -----
  function mostrarErro(texto, campo) {
    erro.textContent = texto || "";
    erro.classList.toggle("hidden", !texto);
    if (texto) {
      erro.scrollIntoView({ block: "center", behavior: "smooth" });
      if (campo) campo.focus();
    }
  }

  function preencher(select, itens, textoVazio) {
    select.innerHTML = `<option value="">${textoVazio}</option>` +
      itens.map((item) => `<option value="${item}">${item}</option>`).join("");
  }

  function criarOpcao(valor, rotulo) {
    const op = document.createElement("option");
    op.value = valor;
    op.textContent = rotulo;
    return op;
  }

  function sincronizarSegmento() {
    const seg = SEGMENTOS[selSegmento.value];
    if (seg) {
      preencher(selAno, seg.anos, "Selecione o ano ou série");
      preencher(selDisciplina, seg.disciplinas, "Selecione a disciplina");
    } else {
      preencher(selAno, [], "Escolha o segmento antes");
      preencher(selDisciplina, [], "Escolha o segmento antes");
    }
    selAno.disabled = !seg;
    selDisciplina.disabled = !seg;
  }

  function sincronizarTipo() {
    const ehMultipla = selTipo.value === "multipla_escolha";
    $("#bloco-mc", area).classList.toggle("hidden", !ehMultipla);
    $("#bloco-disc", area).classList.toggle("hidden", ehMultipla);
  }

  function sincronizarApoio() {
    $("#ap-novo", area).classList.toggle("hidden", selApoio.value !== NOVO_APOIO);
  }

  function atualizarModo() {
    const textos = {
      novo: { titulo: "Nova questão", banner: "", botao: "Salvar questão" },
      editar: {
        titulo: "Editar questão",
        banner: "Você está editando uma questão. Ao salvar, ela volta para validação.",
        botao: "Salvar alterações"
      },
      versao: {
        titulo: "Nova versão de questão",
        banner: "Você está criando uma nova versão a partir de outra questão. A original continua no banco e esta nova passa por validação.",
        botao: "Salvar nova versão"
      }
    }[modo];
    if (modo === "versao" && adaptacaoAtual) {
      textos.titulo = "Nova versão adaptada";
      textos.banner = `Versão adaptada ${adaptacaoAtual.tipo === "tea" ? "para alunos com TEA" : "para alunos não leitores"}, gerada com IA. Revise tudo com cuidado antes de salvar. A questão original continua no banco.`;
    }
    $("#q-titulo", area).textContent = textos.titulo;
    $("#q-banner-texto", area).textContent = textos.banner;
    const banner = $("#q-banner", area);
    banner.classList.toggle("hidden", modo === "novo");
    banner.classList.toggle("flex", modo !== "novo");
    botaoSalvar.textContent = textos.botao;
  }

  function voltarParaNovo() {
    modo = "novo";
    alvo = null;
    adaptacaoAtual = null;
    atualizarModo();
  }

  function atualizarContador() {
    contador.textContent = salvasNaSessao > 0
      ? `Questões cadastradas nesta sessão: ${salvasNaSessao}. Segmento, ano, disciplina, bimestre, assunto e texto de apoio ficam preenchidos para a próxima.`
      : "";
  }

  // ----- Textos de apoio -----
  async function carregarApoios(selecionarId) {
    const atual = selecionarId !== undefined ? selecionarId : selApoio.value;
    selApoio.replaceChildren(
      criarOpcao("", "Sem texto de apoio"),
      criarOpcao(NOVO_APOIO, "Criar novo texto de apoio…")
    );

    if (selSegmento.value && selDisciplina.value) {
      try {
        const lista = await listarApoios(ctx.db, selDisciplina.value);
        lista
          .filter((a) => a.segmento === selSegmento.value)
          .sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), "pt-BR"))
          .forEach((a) => selApoio.appendChild(criarOpcao(a.id, `${a.titulo} (${a.ano})`)));
      } catch (e) {
        console.warn("Não foi possível listar os textos de apoio:", e);
      }
    }

    const existe = Array.from(selApoio.options).some((o) => o.value === atual);
    if (existe) {
      selApoio.value = atual;
    } else if (atual && atual !== NOVO_APOIO) {
      try {
        const apoio = await obterApoio(ctx.db, atual);
        if (apoio) {
          selApoio.appendChild(criarOpcao(apoio.id, `${apoio.titulo} (${apoio.ano})`));
          selApoio.value = apoio.id;
        }
      } catch (e) {
        console.warn("Texto de apoio indisponível:", e);
      }
    }
    sincronizarApoio();
    agendarPrevia();
  }

  // ----- Leitura do formulário -----
  function lerFormulario() {
    return {
      segmento: selSegmento.value,
      ano: selAno.value,
      disciplina: selDisciplina.value,
      bimestre: Number($("#q-bimestre", area).value),
      assunto: $("#q-assunto", area).value.trim(),
      habilidade: $("#q-habilidade", area).value.trim().toUpperCase(),
      tipo: selTipo.value,
      dificuldade: $("#q-dificuldade", area).value,
      enunciado: $("#q-enunciado", area).value.trim(),
      justificativa: $("#q-justificativa", area).value.trim()
    };
  }

  const paraImagem = (item) => ({ dataUrl: item.dataUrl, alt: item.alt });

  // ----- Prévia -----
  async function montarPrevia() {
    const ficha = ++tokenPrevia;
    const d = lerFormulario();
    const destino = $("#q-previa", area);

    const dados = {
      apoio: null,
      enunciado: d.enunciado,
      imagens: seletorEnunciado.getItens().map(paraImagem),
      tipo: d.tipo,
      alternativas: [],
      gabarito: "",
      justificativa: d.justificativa,
      mostrarGabarito: true
    };

    if (d.tipo === "multipla_escolha") {
      const marcada = $('input[name="gabarito-mc"]:checked', area);
      dados.gabarito = marcada ? marcada.value : "";
      LETRAS.forEach((letra) => {
        const texto = $(`#alt-${letra}`, area).value.trim();
        const item = seletoresAlt[letra].getItens()[0];
        if (texto || item) {
          dados.alternativas.push({ letra, texto, imagem: item ? paraImagem(item) : null });
        }
      });
    } else {
      dados.gabarito = $("#q-gabarito-disc", area).value.trim();
    }

    const idApoio = selApoio.value;
    if (idApoio === NOVO_APOIO) {
      dados.apoio = {
        titulo: $("#ap-titulo", area).value.trim(),
        fonte: $("#ap-fonte", area).value.trim(),
        texto: $("#ap-texto", area).value,
        imagens: seletorApoio.getItens().map(paraImagem)
      };
    } else if (idApoio) {
      try {
        const apoio = await obterApoio(ctx.db, idApoio);
        if (apoio) {
          const imagens = (await Promise.all((apoio.imagens || []).map((id) => obterImagem(ctx.db, id))))
            .filter(Boolean).map(paraImagem);
          dados.apoio = { titulo: apoio.titulo, fonte: apoio.fonte, texto: apoio.texto, imagens };
        }
      } catch (e) {
        console.warn(e);
      }
    }

    if (ficha !== tokenPrevia) return; // chegou uma prévia mais nova

    const vazio = !dados.apoio && !dados.enunciado && dados.imagens.length === 0 && dados.alternativas.length === 0;
    if (vazio) {
      destino.replaceChildren(el("p", "text-sm text-[#4B5C6B]", "A prévia aparece aqui conforme você preenche a questão."));
      return;
    }
    desenharQuestao(destino, dados);
  }

  function agendarPrevia() {
    clearTimeout(temporizadorPrevia);
    temporizadorPrevia = setTimeout(montarPrevia, 300);
  }

  // ----- Validação -----
  // Devolve { erro, campo } se algo estiver errado, ou { dados } se estiver tudo certo.
  function validar() {
    const d = lerFormulario();

    if (!d.segmento) return { erro: "Escolha o segmento.", campo: selSegmento };
    if (!d.ano) return { erro: "Escolha o ano ou série.", campo: selAno };
    if (!d.disciplina) return { erro: "Escolha a disciplina.", campo: selDisciplina };
    if (!d.bimestre) return { erro: "Escolha o bimestre.", campo: $("#q-bimestre", area) };
    if (d.assunto.length < 3) return { erro: "Informe o assunto ou eixo temático.", campo: $("#q-assunto", area) };
    if (!d.dificuldade) return { erro: "Escolha a dificuldade.", campo: $("#q-dificuldade", area) };

    if (selApoio.value === NOVO_APOIO) {
      const titulo = $("#ap-titulo", area).value.trim();
      const texto = $("#ap-texto", area).value.trim();
      if (titulo.length < 3) return { erro: "Dê um título ao texto de apoio.", campo: $("#ap-titulo", area) };
      if (texto.length < 10 && seletorApoio.getItens().length === 0) {
        return { erro: "O texto de apoio precisa de texto ou de uma imagem.", campo: $("#ap-texto", area) };
      }
      const erroImagemApoio = seletorApoio.validar();
      if (erroImagemApoio) return { erro: erroImagemApoio };
    }

    if (d.enunciado.length < 10) return { erro: "Escreva o enunciado da questão.", campo: $("#q-enunciado", area) };
    const erroImagemEnunciado = seletorEnunciado.validar();
    if (erroImagemEnunciado) return { erro: erroImagemEnunciado };
    if (d.justificativa.length < 5) return { erro: "Escreva a justificativa da resposta.", campo: $("#q-justificativa", area) };

    if (d.tipo === "multipla_escolha") {
      const alternativas = [];
      for (const letra of LETRAS) {
        const texto = $(`#alt-${letra}`, area).value.trim();
        const item = seletoresAlt[letra].getItens()[0] || null;
        const erroImagem = seletoresAlt[letra].validar();
        if (erroImagem) return { erro: `Alternativa ${letra}: ${erroImagem}` };
        if (texto || item) alternativas.push({ letra, texto, item });
      }

      for (const letra of ["A", "B", "C", "D"]) {
        if (!alternativas.some((alt) => alt.letra === letra)) {
          return { erro: `Preencha a alternativa ${letra} com texto ou imagem.`, campo: $(`#alt-${letra}`, area) };
        }
      }

      const marcada = $('input[name="gabarito-mc"]:checked', area);
      if (!marcada) return { erro: "Marque qual alternativa é a correta.", campo: $("#gab-A", area) };
      if (!alternativas.some((alt) => alt.letra === marcada.value)) {
        return { erro: `A alternativa ${marcada.value} está vazia. Preencha-a ou marque outra como correta.`, campo: $(`#alt-${marcada.value}`, area) };
      }

      return { dados: { ...d, alternativas, gabarito: marcada.value } };
    }

    const esperada = $("#q-gabarito-disc", area).value.trim();
    if (esperada.length < 5) return { erro: "Descreva a resposta esperada.", campo: $("#q-gabarito-disc", area) };
    return { dados: { ...d, alternativas: [], gabarito: esperada } };
  }

  // ----- Limpeza -----
  function limparCamposDaQuestao() {
    ["#q-habilidade", "#q-enunciado", "#q-justificativa", "#q-gabarito-disc"].forEach((id) => {
      $(id, area).value = "";
    });
    LETRAS.forEach((letra) => {
      $(`#alt-${letra}`, area).value = "";
      $(`#gab-${letra}`, area).checked = false;
      seletoresAlt[letra].limpar();
    });
    seletorEnunciado.limpar();
  }

  function limparTudo() {
    form.reset();
    limparCamposDaQuestao();
    seletorApoio.limpar();
    sincronizarSegmento();
    sincronizarTipo();
    selApoio.replaceChildren(criarOpcao("", "Sem texto de apoio"), criarOpcao(NOVO_APOIO, "Criar novo texto de apoio…"));
    sincronizarApoio();
    mostrarErro("");
    agendarPrevia();
  }

  // ----- Edição e nova versão -----
  async function preencherComQuestao(q) {
    limparTudo();

    selSegmento.value = q.segmento;
    sincronizarSegmento();
    selAno.value = q.ano;
    selDisciplina.value = q.disciplina;
    $("#q-bimestre", area).value = String(q.bimestre);
    $("#q-assunto", area).value = q.assunto || "";
    $("#q-habilidade", area).value = q.habilidade || "";
    selTipo.value = q.tipo;
    $("#q-dificuldade", area).value = q.dificuldade;
    $("#q-enunciado", area).value = q.enunciado || "";
    $("#q-justificativa", area).value = q.justificativa || "";
    sincronizarTipo();

    if (q.tipo === "multipla_escolha") {
      for (const alt of q.alternativas || []) {
        const campo = $(`#alt-${alt.letra}`, area);
        if (campo) campo.value = alt.texto || "";
        if (alt.imagemId && seletoresAlt[alt.letra]) {
          await seletoresAlt[alt.letra].carregarIds([alt.imagemId]);
        }
      }
      const radio = $(`#gab-${q.gabarito}`, area);
      if (radio) radio.checked = true;
    } else {
      $("#q-gabarito-disc", area).value = q.gabarito || "";
    }

    await seletorEnunciado.carregarIds(q.enunciadoImagens || []);
    await carregarApoios(q.textoApoioId || "");
    atualizarModo();
    agendarPrevia();
  }

  async function editar(questao) {
    modo = "editar";
    alvo = { id: questao.id };
    adaptacaoAtual = null;
    await preencherComQuestao(questao);
    atualizarModo();
  }

  async function versao(questao) {
    modo = "versao";
    alvo = { id: questao.id };
    adaptacaoAtual = null;
    await preencherComQuestao(questao);
    atualizarModo();
  }

  // Abre o formulário com o texto adaptado pela IA. As imagens e os dados da questão original são mantidos.
  async function versaoAdaptada(original, adaptado, meta) {
    modo = "versao";
    alvo = { id: original.id };
    adaptacaoAtual = null;
    await preencherComQuestao(original);

    $("#q-enunciado", area).value = adaptado.enunciado || "";
    $("#q-justificativa", area).value = adaptado.justificativa || original.justificativa || "";

    if (original.tipo === "multipla_escolha") {
      const originais = new Map((original.alternativas || []).map((alt) => [alt.letra, alt]));
      LETRAS.forEach((letra) => {
        $(`#alt-${letra}`, area).value = "";
        $(`#gab-${letra}`, area).checked = false;
        seletoresAlt[letra].limpar();
      });
      for (const alt of adaptado.alternativas || []) {
        if (!LETRAS.includes(alt.letra)) continue;
        $(`#alt-${alt.letra}`, area).value = alt.texto || "";
        const base = originais.get(alt.origemLetra);
        if (base && base.imagemId) await seletoresAlt[alt.letra].carregarIds([base.imagemId]);
      }
      const radio = $(`#gab-${adaptado.gabarito}`, area);
      if (radio) radio.checked = true;
    } else {
      $("#q-gabarito-disc", area).value = adaptado.gabarito || original.gabarito || "";
    }

    adaptacaoAtual = meta;
    atualizarModo();
    agendarPrevia();
  }

  // ----- Eventos -----
  selSegmento.addEventListener("change", () => {
    sincronizarSegmento();
    carregarApoios("");
  });
  selDisciplina.addEventListener("change", () => carregarApoios());
  selTipo.addEventListener("change", () => {
    sincronizarTipo();
    agendarPrevia();
  });
  selApoio.addEventListener("change", () => {
    sincronizarApoio();
    agendarPrevia();
  });

  form.addEventListener("input", agendarPrevia);
  form.addEventListener("change", agendarPrevia);
  [seletorEnunciado, seletorApoio, ...Object.values(seletoresAlt)].forEach((s) => s.onChange(agendarPrevia));

  $("#q-limpar", area).addEventListener("click", () => {
    limparTudo();
    voltarParaNovo();
  });

  $("#q-cancelar-edicao", area).addEventListener("click", () => {
    limparTudo();
    voltarParaNovo();
    location.hash = "#banco";
  });

  // ----- Salvar -----
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    mostrarErro("");

    const { estado } = ctx;
    if (!estado.usuario || !estado.perfil) {
      mostrarErro("Sua sessão expirou. Entre de novo.");
      return;
    }

    const resultado = validar();
    if (resultado.erro) {
      mostrarErro(resultado.erro, resultado.campo);
      return;
    }

    const d = resultado.dados;
    const uid = estado.usuario.uid;
    botaoSalvar.disabled = true;
    botaoSalvar.textContent = "Salvando…";

    try {
      // 1. Imagens (só as novas são enviadas)
      const idsEnunciado = await persistirImagens(ctx.db, uid, seletorEnunciado.getItens());
      const alternativas = [];
      for (const alt of d.alternativas) {
        let imagemId = null;
        if (alt.item) [imagemId] = await persistirImagens(ctx.db, uid, [alt.item]);
        alternativas.push({ letra: alt.letra, texto: alt.texto, imagemId });
      }

      // 2. Texto de apoio novo
      let textoApoioId = selApoio.value && selApoio.value !== NOVO_APOIO ? selApoio.value : null;
      if (selApoio.value === NOVO_APOIO) {
        const idsApoio = await persistirImagens(ctx.db, uid, seletorApoio.getItens());
        const dadosApoio = {
          titulo: $("#ap-titulo", area).value.trim(),
          fonte: $("#ap-fonte", area).value.trim(),
          texto: $("#ap-texto", area).value.trim(),
          imagens: idsApoio,
          segmento: d.segmento,
          ano: d.ano,
          disciplina: d.disciplina,
          criadoPorUid: uid,
          criadoPor: estado.perfil.nome,
          criadoEm: serverTimestamp()
        };
        const refApoio = await addDoc(collection(ctx.db, "textosApoio"), dadosApoio);
        guardarApoio(refApoio.id, dadosApoio);
        textoApoioId = refApoio.id;
        // Evita criar o mesmo texto duas vezes se o salvamento da questão falhar.
        selApoio.appendChild(criarOpcao(refApoio.id, `${dadosApoio.titulo} (${dadosApoio.ano})`));
        selApoio.value = refApoio.id;
        sincronizarApoio();
        seletorApoio.limpar();
        await ctx.registrarAuditoria("texto_apoio_criado", {
          textoApoioId: refApoio.id,
          titulo: dadosApoio.titulo,
          disciplina: d.disciplina
        });
      }

      const campos = {
        segmento: d.segmento,
        ano: d.ano,
        disciplina: d.disciplina,
        bimestre: d.bimestre,
        assunto: d.assunto,
        habilidade: d.habilidade,
        tipo: d.tipo,
        dificuldade: d.dificuldade,
        enunciado: d.enunciado,
        enunciadoImagens: idsEnunciado,
        alternativas,
        gabarito: d.gabarito,
        justificativa: d.justificativa,
        textoApoioId
      };

      // 3. Questão
      if (modo === "editar" && alvo) {
        await updateDoc(doc(ctx.db, "questoes", alvo.id), {
          ...campos,
          ultimaModificacaoPor: estado.perfil.nome,
          ultimaModificacaoEm: serverTimestamp(),
          statusValidacao: "pendente",
          validadoPor: null,
          validadoPorUid: null,
          validadoEm: null,
          motivoRejeicao: null
        });

        await ctx.registrarAuditoria("questao_editada", {
          questaoId: alvo.id,
          disciplina: d.disciplina,
          ano: d.ano,
          assunto: d.assunto
        });

        limparTudo();
        voltarParaNovo();
        ctx.aviso("Alterações salvas. A questão voltou para validação.");
        if (typeof ctx.aoSalvar === "function") ctx.aoSalvar();
        location.hash = "#banco";
        return;
      }

      const ref = await addDoc(collection(ctx.db, "questoes"), {
        ...campos,
        // Metadados de auditoria e responsabilidade
        criadoPorUid: uid,
        criadoPor: estado.perfil.nome,
        cargo: estado.perfil.cargo,
        criadoEm: serverTimestamp(),
        ultimaModificacaoPor: estado.perfil.nome,
        ultimaModificacaoEm: serverTimestamp(),
        responsavelUid: uid,
        responsavel: estado.perfil.nome,
        statusValidacao: "pendente",
        arquivada: false,
        origem: "manual",
        derivadaDeId: modo === "versao" && alvo ? alvo.id : null,
        adaptacao: adaptacaoAtual ? adaptacaoAtual.tipo : null,
        adaptacaoSuportesVisuais: adaptacaoAtual ? adaptacaoAtual.suportesVisuais || [] : [],
        adaptacaoOrientacao: adaptacaoAtual ? adaptacaoAtual.orientacao || "" : "",
        adaptacaoPorIA: Boolean(adaptacaoAtual),
        schemaVersao: 2
      });

      await ctx.registrarAuditoria(modo === "versao" ? "questao_versao_criada" : "questao_criada", {
        questaoId: ref.id,
        derivadaDeId: modo === "versao" && alvo ? alvo.id : null,
        adaptacao: adaptacaoAtual ? adaptacaoAtual.tipo : null,
        segmento: d.segmento,
        ano: d.ano,
        disciplina: d.disciplina,
        bimestre: d.bimestre,
        tipo: d.tipo
      });

      salvasNaSessao += 1;
      atualizarContador();
      ctx.aviso("Questão salva. Aguarda validação do Supervisor.");
      if (typeof ctx.aoSalvar === "function") ctx.aoSalvar();

      if (modo === "versao") {
        limparTudo();
        voltarParaNovo();
        location.hash = "#banco";
        return;
      }
      limparCamposDaQuestao();
      agendarPrevia();
      $("#q-enunciado", area).focus();
    } catch (e) {
      console.error(e);
      const semPermissao = e && e.code === "permission-denied";
      mostrarErro(semPermissao
        ? "O Firestore recusou o salvamento. Confira se publicou as regras do arquivo firestore.rules e se sua conta está ativa."
        : "Não foi possível salvar. Verifique sua conexão e tente de novo.");
    } finally {
      botaoSalvar.disabled = false;
      atualizarModo();
    }
  });

  limparTudo();
  atualizarModo();

  return { editar, versao, versaoAdaptada };
}
