import {
  collection, getDocs, query, orderBy, limit, doc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SEGMENTOS, BIMESTRES, TIPOS, DIFICULDADES } from "./curriculo.js";
import { $, el, normalizar, formatarData, rotuloCargo } from "./util.js";
import { perguntar } from "./dialogo.js";
import { renderRico, desenharQuestao } from "./rico.js";
import { obterImagem, obterApoio } from "./midia.js";

const LIMITE_CARREGADO = 300;
const POR_PAGINA = 20;

const STATUS = {
  pendente: { rotulo: "Aguardando validação", classes: "bg-[#FFF6DB] text-[#6B4E00] border-marca" },
  aprovada: { rotulo: "Banco Oficial", classes: "bg-petroleo-claro text-petroleo-escuro border-petroleo" },
  rejeitada: { rotulo: "Devolvida", classes: "bg-[#FBE9E4] text-alerta border-alerta" }
};

const paraImagem = (img) => ({ dataUrl: img.dataUrl, alt: img.alt });

export function iniciarBanco(ctx) {
  const area = document.getElementById("area-banco");
  if (!area) return { carregar() {}, limpar() {} };

  let lista = [];
  let carregou = false;
  let visiveis = POR_PAGINA;

  const filtros = {
    busca: "", segmento: "", ano: "", disciplina: "", bimestre: "",
    tipo: "", dificuldade: "", status: "", adaptacao: "", soMinhas: false, arquivadas: false
  };

  function opcoesHtml(itens, textoVazio) {
    return `<option value="">${textoVazio}</option>` +
      itens.map((i) => `<option value="${i.valor}">${i.rotulo}</option>`).join("");
  }

  area.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Banco de questões</h1>
        <p class="mt-1 text-[#33475B]">Questões marcadas como Banco Oficial já foram validadas pela coordenação.</p>
      </div>
      <button type="button" id="b-atualizar"
              class="rounded-[10px] border-2 border-petroleo px-4 py-2 font-bold text-petroleo hover:bg-petroleo-claro">
        Atualizar lista
      </button>
    </div>

    <section class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4" aria-label="Filtros">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="sm:col-span-2 lg:col-span-3">
          <label class="rotulo" for="b-busca">Buscar por texto</label>
          <input id="b-busca" type="search" class="campo" placeholder="Assunto, enunciado, habilidade ou autor" autocomplete="off">
        </div>
        <div>
          <label class="rotulo" for="b-segmento">Segmento</label>
          <select id="b-segmento" class="campo">${opcoesHtml(
            Object.entries(SEGMENTOS).map(([valor, s]) => ({ valor, rotulo: s.rotulo })), "Todos")}</select>
        </div>
        <div>
          <label class="rotulo" for="b-ano">Ano / série</label>
          <select id="b-ano" class="campo"></select>
        </div>
        <div>
          <label class="rotulo" for="b-disciplina">Disciplina</label>
          <select id="b-disciplina" class="campo"></select>
        </div>
        <div>
          <label class="rotulo" for="b-bimestre">Bimestre</label>
          <select id="b-bimestre" class="campo">${opcoesHtml(
            BIMESTRES.map((n) => ({ valor: String(n), rotulo: `${n}º bimestre` })), "Todos")}</select>
        </div>
        <div>
          <label class="rotulo" for="b-tipo">Tipo</label>
          <select id="b-tipo" class="campo">${opcoesHtml(
            Object.entries(TIPOS).map(([valor, rotulo]) => ({ valor, rotulo })), "Todos")}</select>
        </div>
        <div>
          <label class="rotulo" for="b-dificuldade">Dificuldade</label>
          <select id="b-dificuldade" class="campo">${opcoesHtml(
            Object.entries(DIFICULDADES).map(([valor, rotulo]) => ({ valor, rotulo })), "Todas")}</select>
        </div>
        <div>
          <label class="rotulo" for="b-status">Situação</label>
          <select id="b-status" class="campo">${opcoesHtml(
            Object.entries(STATUS).map(([valor, s]) => ({ valor, rotulo: s.rotulo })), "Todas")}</select>
        </div>
        <div>
          <label class="rotulo" for="b-adaptacao">Adaptação</label>
          <select id="b-adaptacao" class="campo">
            <option value="">Todas</option>
            <option value="nenhuma">Sem adaptação</option>
            <option value="tea">Adaptada para TEA</option>
            <option value="nao_leitor">Adaptada para não leitores</option>
          </select>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-3 py-3 font-bold">
            <input id="b-minhas" type="checkbox" class="h-5 w-5 accent-[#0F6B6B]">
            Só as minhas
          </label>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-3 py-3 font-bold">
            <input id="b-arquivadas" type="checkbox" class="h-5 w-5 accent-[#0F6B6B]">
            Mostrar arquivadas
          </label>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p id="b-contagem" class="text-sm font-bold text-[#33475B]" aria-live="polite"></p>
        <button type="button" id="b-limpar-filtros" class="text-sm font-bold text-petroleo underline underline-offset-4">Limpar filtros</button>
      </div>
    </section>

    <div id="b-estado" class="mt-5"></div>
    <ul id="b-lista" class="mt-5 space-y-4"></ul>
    <div class="mt-5 text-center"><button type="button" id="b-mais" class="hidden rounded-[10px] border-2 border-petroleo px-5 py-2.5 font-bold text-petroleo hover:bg-petroleo-claro">Mostrar mais questões</button></div>
  `;

  const selSegmento = $("#b-segmento", area);
  const selAno = $("#b-ano", area);
  const selDisciplina = $("#b-disciplina", area);

  function preencherAnoEDisciplina() {
    const segs = filtros.segmento ? [SEGMENTOS[filtros.segmento]] : Object.values(SEGMENTOS);
    const anos = [...new Set(segs.flatMap((s) => s.anos))];
    const disciplinas = [...new Set(segs.flatMap((s) => s.disciplinas))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    selAno.innerHTML = `<option value="">Todos</option>` + anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    selDisciplina.innerHTML = `<option value="">Todas</option>` + disciplinas.map((d) => `<option value="${d}">${d}</option>`).join("");
    filtros.ano = "";
    filtros.disciplina = "";
  }

  // ----- Quem é o responsável -----
  const responsavelUidDe = (q) => q.responsavelUid || q.criadoPorUid;
  const responsavelNomeDe = (q) => q.responsavel || q.criadoPor;

  // ----- Filtragem -----
  function filtrar() {
    const busca = normalizar(filtros.busca);
    const meuUid = ctx.estado.usuario ? ctx.estado.usuario.uid : "";
    return lista.filter((q) => {
      if (q.arquivada && !filtros.arquivadas) return false;
      if (filtros.segmento && q.segmento !== filtros.segmento) return false;
      if (filtros.ano && q.ano !== filtros.ano) return false;
      if (filtros.disciplina && q.disciplina !== filtros.disciplina) return false;
      if (filtros.bimestre && String(q.bimestre) !== filtros.bimestre) return false;
      if (filtros.tipo && q.tipo !== filtros.tipo) return false;
      if (filtros.dificuldade && q.dificuldade !== filtros.dificuldade) return false;
      if (filtros.status && q.statusValidacao !== filtros.status) return false;
      if (filtros.adaptacao === "nenhuma" && q.adaptacao) return false;
      if (filtros.adaptacao && filtros.adaptacao !== "nenhuma" && q.adaptacao !== filtros.adaptacao) return false;
      if (filtros.soMinhas && responsavelUidDe(q) !== meuUid) return false;
      if (busca) {
        const texto = normalizar([q.assunto, q.enunciado, q.habilidade, q.disciplina, q.criadoPor, responsavelNomeDe(q)].join(" "));
        if (!texto.includes(busca)) return false;
      }
      return true;
    });
  }

  // ----- Detalhe da questão (carrega imagens e texto de apoio sob demanda) -----
  function linhaAuditoria(q) {
    const partes = [
      `Criada por ${q.criadoPor || "autor desconhecido"} (${rotuloCargo(q.cargo)}) em ${formatarData(q.criadoEm)}.`,
      `Responsável atual: ${responsavelNomeDe(q) || "não definido"}.`,
      `Última alteração por ${q.ultimaModificacaoPor || "autor desconhecido"} em ${formatarData(q.ultimaModificacaoEm)}.`
    ];
    if (q.statusValidacao === "aprovada" && q.validadoPor) {
      partes.push(`Aprovada por ${q.validadoPor} em ${formatarData(q.validadoEm)}.`);
    }
    if (q.statusValidacao === "rejeitada" && q.validadoPor) {
      partes.push(`Devolvida por ${q.validadoPor} em ${formatarData(q.validadoEm)}.`);
    }
    if (q.derivadaDeId) partes.push("Esta questão é uma versão criada a partir de outra do banco.");
    return partes.join(" ");
  }

  async function carregarDetalhe(q, conteudo) {
    conteudo.replaceChildren(el("p", "text-sm text-[#4B5C6B]", "Carregando a questão completa…"));
    try {
      const resolver = async (ids) =>
        (await Promise.all((ids || []).map((id) => obterImagem(ctx.db, id)))).filter(Boolean).map(paraImagem);

      const apoioDoc = q.textoApoioId ? await obterApoio(ctx.db, q.textoApoioId) : null;
      const dados = {
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
        justificativa: q.justificativa,
        mostrarGabarito: true
      };

      const quadro = el("div");
      desenharQuestao(quadro, dados);
      conteudo.replaceChildren(quadro);

      if (q.habilidade) {
        const hab = el("p", "mt-3");
        hab.appendChild(el("strong", "", "Habilidade: "));
        hab.appendChild(document.createTextNode(q.habilidade));
        conteudo.appendChild(hab);
      }
      if (q.adaptacao) {
        const caixaAdaptacao = el("div", "mt-3 rounded-lg bg-petroleo-claro p-3 text-sm");
        caixaAdaptacao.appendChild(el("p", "font-bold", `Versão adaptada ${q.adaptacao === "tea" ? "para TEA" : "para não leitores"}${q.adaptacaoPorIA ? " (gerada com IA e revisada por professor)" : ""}`));
        if (q.adaptacaoOrientacao) {
          const orient = el("p", "mt-1 whitespace-pre-wrap");
          orient.appendChild(el("strong", "", "Orientação a quem aplica: "));
          orient.appendChild(document.createTextNode(q.adaptacaoOrientacao));
          caixaAdaptacao.appendChild(orient);
        }
        (q.adaptacaoSuportesVisuais || []).forEach((s) => {
          const linhaSuporte = el("p", "mt-1");
          linhaSuporte.appendChild(el("strong", "", `Imagem de apoio (${s.onde}): `));
          linhaSuporte.appendChild(document.createTextNode(s.descricao));
          caixaAdaptacao.appendChild(linhaSuporte);
        });
        conteudo.appendChild(caixaAdaptacao);
      }
      conteudo.appendChild(el("p", "mt-3 border-t border-[#E3E9EE] pt-3 text-sm text-[#4B5C6B]", linhaAuditoria(q)));
    } catch (e) {
      console.error(e);
      conteudo.replaceChildren(el("p", "text-sm font-bold text-alerta", "Não foi possível carregar a questão completa."));
    }
  }

  // ----- Cartão -----
  function criarCartao(q) {
    const ehSupervisor = ctx.estado.perfil.cargo === "supervisor";
    const ehResponsavel = responsavelUidDe(q) === ctx.estado.usuario.uid;
    const situacao = STATUS[q.statusValidacao] || STATUS.pendente;
    const podeMexer = ehSupervisor || (ehResponsavel && q.statusValidacao !== "aprovada");

    const item = el("li", "rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5" + (q.arquivada ? " opacity-80" : ""));

    const selos = el("div", "flex flex-wrap gap-2");
    selos.appendChild(el("span", `rounded-full border px-3 py-1 text-sm font-bold ${situacao.classes}`, situacao.rotulo));
    if (q.arquivada) selos.appendChild(el("span", "rounded-full border border-[#33475B] bg-[#E8EDF1] px-3 py-1 text-sm font-bold text-[#33475B]", "Arquivada"));
    if (q.adaptacao) selos.appendChild(el("span", "rounded-full border border-petroleo bg-petroleo-claro px-3 py-1 text-sm font-bold text-petroleo-escuro", q.adaptacao === "tea" ? "Adaptada: TEA" : "Adaptada: não leitor"));
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-1 text-sm font-bold text-[#33475B]", DIFICULDADES[q.dificuldade] || ""));
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-1 text-sm font-bold text-[#33475B]", TIPOS[q.tipo] || ""));
    item.appendChild(selos);

    item.appendChild(el("h3", "mt-3 text-lg font-bold leading-snug", q.assunto || "Sem assunto"));

    let autoria = `${q.disciplina}, ${q.ano}, ${q.bimestre}º bimestre. Autor: ${q.criadoPor || "desconhecido"}`;
    if (responsavelUidDe(q) !== q.criadoPorUid) autoria += `. Responsável: ${responsavelNomeDe(q) || "não definido"}`;
    item.appendChild(el("p", "text-sm text-[#4B5C6B]", autoria));

    const previa = el("p", "mt-2 line-clamp-3 whitespace-pre-wrap");
    renderRico(previa, q.enunciado || "");
    item.appendChild(previa);

    if (q.statusValidacao === "rejeitada" && q.motivoRejeicao) {
      const motivo = el("p", "mt-3 rounded-lg bg-[#FBE9E4] p-3 text-sm");
      motivo.appendChild(el("strong", "", "Motivo da devolução: "));
      motivo.appendChild(document.createTextNode(q.motivoRejeicao));
      item.appendChild(motivo);
    }

    const detalhes = el("details", "mt-3 rounded-lg border border-[#E3E9EE] p-3");
    detalhes.appendChild(el("summary", "cursor-pointer font-bold text-petroleo", "Ver questão completa"));
    const conteudo = el("div", "mt-3");
    detalhes.appendChild(conteudo);
    let aberto = false;
    detalhes.addEventListener("toggle", () => {
      if (detalhes.open && !aberto) {
        aberto = true;
        carregarDetalhe(q, conteudo);
      }
    });
    item.appendChild(detalhes);

    const acoes = el("div", "mt-4 flex flex-wrap gap-2");
    const botao = (texto, classes, aoClicar) => {
      const b = el("button", `rounded-[10px] px-4 py-2 font-bold ${classes}`, texto);
      b.type = "button";
      b.addEventListener("click", aoClicar);
      acoes.appendChild(b);
    };

    if (ehSupervisor && !q.arquivada && q.statusValidacao !== "aprovada") {
      botao("Aprovar", "bg-petroleo text-white hover:bg-petroleo-escuro", () => aprovar(q));
    }
    if (ehSupervisor && !q.arquivada && q.statusValidacao !== "rejeitada") {
      botao("Devolver", "border-2 border-alerta text-alerta hover:bg-[#FBE9E4]", () => devolver(q));
    }
    if (podeMexer) {
      botao("Editar", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => ctx.aoEditar(q));
    }
    botao("Adaptar com IA", "border-2 border-petroleo text-petroleo hover:bg-petroleo-claro", () => ctx.aoAdaptar(q));
    botao("Criar versão", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => ctx.aoVersao(q));
    if (ehSupervisor) {
      botao(q.arquivada ? "Restaurar" : "Arquivar", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => alternarArquivo(q));
    }
    if (podeMexer) {
      botao("Excluir", "border-2 border-[#9FB0BE] text-alerta hover:bg-[#FBE9E4]", () => excluir(q));
    }
    item.appendChild(acoes);

    return item;
  }

  // ----- Desenho da lista -----
  function desenhar() {
    const ul = $("#b-lista", area);
    const estadoBox = $("#b-estado", area);
    const botaoMais = $("#b-mais", area);
    ul.replaceChildren();
    estadoBox.replaceChildren();

    if (!carregou) return;

    const resultado = filtrar();
    $("#b-contagem", area).textContent = `Mostrando ${Math.min(visiveis, resultado.length)} de ${resultado.length} questões (${lista.length} carregadas)`;

    if (lista.length === 0) {
      const caixa = el("div", "rounded-xl border border-dashed border-[#9FB0BE] bg-white p-6");
      caixa.appendChild(el("p", "font-bold", "Nenhuma questão cadastrada ainda."));
      caixa.appendChild(el("p", "mt-1 text-[#33475B]", "Cadastre a primeira em “Nova questão”."));
      const link = el("a", "btn mt-4 !w-auto", "Cadastrar questão");
      link.href = "#nova";
      caixa.appendChild(link);
      estadoBox.appendChild(caixa);
      botaoMais.classList.add("hidden");
      return;
    }

    if (resultado.length === 0) {
      const caixa = el("div", "rounded-xl border border-dashed border-[#9FB0BE] bg-white p-6");
      caixa.appendChild(el("p", "font-bold", "Nenhuma questão com esses filtros."));
      caixa.appendChild(el("p", "mt-1 text-[#33475B]", "Mude os filtros ou limpe todos para ver o banco inteiro."));
      estadoBox.appendChild(caixa);
      botaoMais.classList.add("hidden");
      return;
    }

    resultado.slice(0, visiveis).forEach((q) => ul.appendChild(criarCartao(q)));
    botaoMais.classList.toggle("hidden", resultado.length <= visiveis);
  }

  function mostrarMensagem(texto, tipo = "info") {
    const estadoBox = $("#b-estado", area);
    estadoBox.replaceChildren();
    const classes = tipo === "erro"
      ? "rounded-xl bg-[#FBE9E4] p-4 font-bold text-alerta"
      : "rounded-xl bg-white border border-[#D5DDE4] p-4 font-bold text-[#33475B]";
    const p = el("p", classes, texto);
    p.setAttribute("role", tipo === "erro" ? "alert" : "status");
    estadoBox.appendChild(p);
  }

  // ----- Carregamento -----
  async function carregar() {
    if (!ctx.estado.usuario) return;
    $("#b-lista", area).replaceChildren();
    $("#b-mais", area).classList.add("hidden");
    mostrarMensagem("Carregando questões…");
    try {
      const snap = await getDocs(query(collection(ctx.db, "questoes"), orderBy("criadoEm", "desc"), limit(LIMITE_CARREGADO)));
      lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      carregou = true;
      visiveis = POR_PAGINA;
      desenhar();
    } catch (e) {
      console.error(e);
      carregou = false;
      mostrarMensagem(e && e.code === "permission-denied"
        ? "O Firestore recusou a leitura. Confira se publicou as regras do arquivo firestore.rules e se sua conta está ativa."
        : "Não foi possível carregar as questões. Verifique a conexão e toque em Atualizar lista.", "erro");
    }
  }

  function limpar() {
    lista = [];
    carregou = false;
    $("#b-lista", area).replaceChildren();
    $("#b-estado", area).replaceChildren();
    $("#b-contagem", area).textContent = "";
  }

  // ----- Ações -----
  async function depoisDeAlterar() {
    ctx.aoAlterar();
    await carregar();
  }

  async function aprovar(q) {
    const { perfil, usuario } = ctx.estado;
    try {
      await updateDoc(doc(ctx.db, "questoes", q.id), {
        statusValidacao: "aprovada",
        validadoPor: perfil.nome,
        validadoPorUid: usuario.uid,
        validadoEm: serverTimestamp(),
        motivoRejeicao: null,
        ultimaModificacaoPor: perfil.nome,
        ultimaModificacaoEm: serverTimestamp()
      });
      await ctx.registrarAuditoria("questao_aprovada", { questaoId: q.id, disciplina: q.disciplina, assunto: q.assunto });
      ctx.aviso("Questão aprovada e incluída no Banco Oficial.");
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível aprovar a questão.", "erro");
    }
  }

  async function devolver(q) {
    const resposta = await perguntar({
      titulo: "Devolver questão ao responsável",
      texto: "A questão sai do Banco Oficial e o responsável vê o motivo que você escrever.",
      rotuloOk: "Devolver questão",
      pedirMotivo: true,
      perigo: true
    });
    if (!resposta.ok) return;

    const { perfil, usuario } = ctx.estado;
    try {
      await updateDoc(doc(ctx.db, "questoes", q.id), {
        statusValidacao: "rejeitada",
        validadoPor: perfil.nome,
        validadoPorUid: usuario.uid,
        validadoEm: serverTimestamp(),
        motivoRejeicao: resposta.motivo,
        ultimaModificacaoPor: perfil.nome,
        ultimaModificacaoEm: serverTimestamp()
      });
      await ctx.registrarAuditoria("questao_devolvida", { questaoId: q.id, disciplina: q.disciplina, assunto: q.assunto, motivo: resposta.motivo });
      ctx.aviso("Questão devolvida.");
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível devolver a questão.", "erro");
    }
  }

  async function alternarArquivo(q) {
    const arquivar = !q.arquivada;
    const resposta = await perguntar({
      titulo: arquivar ? "Arquivar questão" : "Restaurar questão",
      texto: arquivar
        ? "A questão sai das listas e das provas, mas continua guardada e pode ser restaurada."
        : "A questão volta a aparecer nas listas e pode ser usada em provas.",
      rotuloOk: arquivar ? "Arquivar" : "Restaurar"
    });
    if (!resposta.ok) return;

    const { perfil } = ctx.estado;
    try {
      await updateDoc(doc(ctx.db, "questoes", q.id), {
        arquivada: arquivar,
        ultimaModificacaoPor: perfil.nome,
        ultimaModificacaoEm: serverTimestamp()
      });
      await ctx.registrarAuditoria(arquivar ? "questao_arquivada" : "questao_restaurada", {
        questaoId: q.id, disciplina: q.disciplina, assunto: q.assunto
      });
      ctx.aviso(arquivar ? "Questão arquivada." : "Questão restaurada.");
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível concluir a ação.", "erro");
    }
  }

  async function excluir(q) {
    const resposta = await perguntar({
      titulo: "Excluir questão",
      texto: `Excluir a questão sobre “${q.assunto}”? Essa ação não pode ser desfeita. Para tirar uma questão de uso sem perdê-la, peça ao Supervisor para arquivar.`,
      rotuloOk: "Excluir questão",
      perigo: true
    });
    if (!resposta.ok) return;

    try {
      await deleteDoc(doc(ctx.db, "questoes", q.id));
      await ctx.registrarAuditoria("questao_excluida", {
        questaoId: q.id,
        disciplina: q.disciplina,
        ano: q.ano,
        assunto: q.assunto,
        autor: q.criadoPor || ""
      });
      ctx.aviso("Questão excluída.");
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível excluir a questão.", "erro");
    }
  }

  // ----- Eventos dos filtros -----
  function aoMudarFiltro() {
    visiveis = POR_PAGINA;
    desenhar();
  }

  $("#b-busca", area).addEventListener("input", (ev) => { filtros.busca = ev.target.value; aoMudarFiltro(); });
  selSegmento.addEventListener("change", (ev) => {
    filtros.segmento = ev.target.value;
    preencherAnoEDisciplina();
    aoMudarFiltro();
  });
  selAno.addEventListener("change", (ev) => { filtros.ano = ev.target.value; aoMudarFiltro(); });
  selDisciplina.addEventListener("change", (ev) => { filtros.disciplina = ev.target.value; aoMudarFiltro(); });
  $("#b-bimestre", area).addEventListener("change", (ev) => { filtros.bimestre = ev.target.value; aoMudarFiltro(); });
  $("#b-tipo", area).addEventListener("change", (ev) => { filtros.tipo = ev.target.value; aoMudarFiltro(); });
  $("#b-dificuldade", area).addEventListener("change", (ev) => { filtros.dificuldade = ev.target.value; aoMudarFiltro(); });
  $("#b-status", area).addEventListener("change", (ev) => { filtros.status = ev.target.value; aoMudarFiltro(); });
  $("#b-adaptacao", area).addEventListener("change", (ev) => { filtros.adaptacao = ev.target.value; aoMudarFiltro(); });
  $("#b-minhas", area).addEventListener("change", (ev) => { filtros.soMinhas = ev.target.checked; aoMudarFiltro(); });
  $("#b-arquivadas", area).addEventListener("change", (ev) => { filtros.arquivadas = ev.target.checked; aoMudarFiltro(); });

  $("#b-limpar-filtros", area).addEventListener("click", () => {
    Object.assign(filtros, {
      busca: "", segmento: "", ano: "", disciplina: "", bimestre: "",
      tipo: "", dificuldade: "", status: "", adaptacao: "", soMinhas: false, arquivadas: false
    });
    $("#b-busca", area).value = "";
    selSegmento.value = "";
    preencherAnoEDisciplina();
    ["#b-bimestre", "#b-tipo", "#b-dificuldade", "#b-status", "#b-adaptacao"].forEach((id) => { $(id, area).value = ""; });
    $("#b-minhas", area).checked = false;
    $("#b-arquivadas", area).checked = false;
    aoMudarFiltro();
  });

  $("#b-atualizar", area).addEventListener("click", carregar);
  $("#b-mais", area).addEventListener("click", () => {
    visiveis += POR_PAGINA;
    desenhar();
  });

  // Recarrega a lista sempre que a pessoa abre a tela do Banco.
  window.addEventListener("hashchange", () => {
    if (location.hash === "#banco") carregar();
  });

  preencherAnoEDisciplina();

  return { carregar, limpar };
}
