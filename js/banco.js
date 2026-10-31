import {
  collection, getDocs, query, orderBy, limit, doc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SEGMENTOS, BIMESTRES, TIPOS, DIFICULDADES } from "./curriculo.js";

const LIMITE_CARREGADO = 300;
const POR_PAGINA = 20;

const STATUS = {
  pendente: { rotulo: "Aguardando validação", classes: "bg-[#FFF6DB] text-[#6B4E00] border-marca" },
  aprovada: { rotulo: "Banco Oficial", classes: "bg-petroleo-claro text-petroleo-escuro border-petroleo" },
  rejeitada: { rotulo: "Devolvida", classes: "bg-[#FBE9E4] text-alerta border-alerta" }
};

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

// Cria um elemento com texto seguro (nunca interpreta HTML vindo do banco).
function el(tag, classes = "", texto = "") {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (texto) e.textContent = texto;
  return e;
}

function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatarData(ts) {
  if (!ts || typeof ts.toDate !== "function") return "agora há pouco";
  return ts.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function rotuloCargo(cargo) {
  return cargo === "supervisor" ? "Supervisor(a)" : "Professor(a)";
}

// ---------- Janela de confirmação ----------
function perguntar({ titulo, texto, rotuloOk, pedirMotivo = false, perigo = false }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", "w-[min(92vw,28rem)] rounded-xl p-0 text-tinta backdrop:bg-black/50");
    const corpo = el("div", "p-5");
    corpo.appendChild(el("h2", "text-lg font-bold", titulo));
    corpo.appendChild(el("p", "mt-2 text-[#33475B]", texto));

    let campo = null;
    let aviso = null;
    if (pedirMotivo) {
      const rotulo = el("label", "rotulo mt-4", "Motivo da devolução");
      campo = el("textarea", "campo");
      campo.rows = 3;
      campo.maxLength = 500;
      campo.id = "motivo-devolucao";
      rotulo.htmlFor = campo.id;
      aviso = el("p", "mt-2 hidden text-sm font-bold text-alerta", "Explique o motivo com pelo menos 5 letras.");
      aviso.setAttribute("role", "alert");
      corpo.append(rotulo, campo, aviso);
    }

    const botoes = el("div", "mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end");
    const cancelar = el("button", "rounded-[10px] border-2 border-[#9FB0BE] px-5 py-2.5 font-bold text-[#33475B]", "Cancelar");
    cancelar.type = "button";
    const confirmar = el("button", "rounded-[10px] px-5 py-2.5 font-bold text-white " + (perigo ? "bg-alerta" : "bg-petroleo"), rotuloOk);
    confirmar.type = "button";
    botoes.append(cancelar, confirmar);
    corpo.appendChild(botoes);
    dlg.appendChild(corpo);

    let resultado = { ok: false, motivo: "" };

    cancelar.addEventListener("click", () => dlg.close());
    confirmar.addEventListener("click", () => {
      if (campo && campo.value.trim().length < 5) {
        aviso.classList.remove("hidden");
        campo.focus();
        return;
      }
      resultado = { ok: true, motivo: campo ? campo.value.trim() : "" };
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(resultado);
    });

    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

// ---------- Módulo ----------
export function iniciarBanco(ctx) {
  const area = document.getElementById("area-banco");
  if (!area) return { carregar() {}, limpar() {} };

  let lista = [];
  let carregou = false;
  let visiveis = POR_PAGINA;

  const filtros = {
    busca: "", segmento: "", ano: "", disciplina: "", bimestre: "",
    tipo: "", dificuldade: "", status: "", soMinhas: false
  };

  // ----- Estrutura fixa da tela -----
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
        <div class="flex items-end">
          <label class="flex items-center gap-3 py-3 font-bold">
            <input id="b-minhas" type="checkbox" class="h-5 w-5 accent-[#0F6B6B]">
            Só as minhas
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

  // ----- Filtragem -----
  function filtrar() {
    const busca = normalizar(filtros.busca);
    const meuUid = ctx.estado.usuario ? ctx.estado.usuario.uid : "";
    return lista.filter((q) => {
      if (filtros.segmento && q.segmento !== filtros.segmento) return false;
      if (filtros.ano && q.ano !== filtros.ano) return false;
      if (filtros.disciplina && q.disciplina !== filtros.disciplina) return false;
      if (filtros.bimestre && String(q.bimestre) !== filtros.bimestre) return false;
      if (filtros.tipo && q.tipo !== filtros.tipo) return false;
      if (filtros.dificuldade && q.dificuldade !== filtros.dificuldade) return false;
      if (filtros.status && q.statusValidacao !== filtros.status) return false;
      if (filtros.soMinhas && q.criadoPorUid !== meuUid) return false;
      if (busca) {
        const texto = normalizar([q.assunto, q.enunciado, q.habilidade, q.disciplina, q.criadoPor].join(" "));
        if (!texto.includes(busca)) return false;
      }
      return true;
    });
  }

  // ----- Cartão de questão -----
  function linhaAuditoria(q) {
    const partes = [
      `Criada por ${q.criadoPor || "autor desconhecido"} (${rotuloCargo(q.cargo)}) em ${formatarData(q.criadoEm)}.`,
      `Última alteração por ${q.ultimaModificacaoPor || "autor desconhecido"} em ${formatarData(q.ultimaModificacaoEm)}.`
    ];
    if (q.statusValidacao === "aprovada" && q.validadoPor) {
      partes.push(`Aprovada por ${q.validadoPor} em ${formatarData(q.validadoEm)}.`);
    }
    if (q.statusValidacao === "rejeitada" && q.validadoPor) {
      partes.push(`Devolvida por ${q.validadoPor} em ${formatarData(q.validadoEm)}.`);
    }
    return partes.join(" ");
  }

  function criarCartao(q) {
    const ehSupervisor = ctx.estado.perfil.cargo === "supervisor";
    const ehDono = q.criadoPorUid === ctx.estado.usuario.uid;
    const situacao = STATUS[q.statusValidacao] || STATUS.pendente;

    const item = el("li", "rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5");

    // Selos
    const selos = el("div", "flex flex-wrap gap-2");
    selos.appendChild(el("span", `rounded-full border px-3 py-1 text-sm font-bold ${situacao.classes}`, situacao.rotulo));
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-1 text-sm font-bold text-[#33475B]", DIFICULDADES[q.dificuldade] || ""));
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-1 text-sm font-bold text-[#33475B]", TIPOS[q.tipo] || ""));
    item.appendChild(selos);

    // Título e resumo
    item.appendChild(el("h3", "mt-3 text-lg font-bold leading-snug", q.assunto || "Sem assunto"));
    item.appendChild(el("p", "text-sm text-[#4B5C6B]", `${q.disciplina}, ${q.ano}, ${q.bimestre}º bimestre. Autor: ${q.criadoPor || "desconhecido"}`));
    item.appendChild(el("p", "mt-2 line-clamp-3 whitespace-pre-wrap", q.enunciado || ""));

    if (q.statusValidacao === "rejeitada" && q.motivoRejeicao) {
      const motivo = el("p", "mt-3 rounded-lg bg-[#FBE9E4] p-3 text-sm");
      motivo.appendChild(el("strong", "", "Motivo da devolução: "));
      motivo.appendChild(document.createTextNode(q.motivoRejeicao));
      item.appendChild(motivo);
    }

    // Detalhes
    const detalhes = el("details", "mt-3 rounded-lg border border-[#E3E9EE] p-3");
    detalhes.appendChild(el("summary", "cursor-pointer font-bold text-petroleo", "Ver questão completa"));

    const conteudo = el("div", "mt-3 space-y-3");
    conteudo.appendChild(el("p", "whitespace-pre-wrap", q.enunciado || ""));

    if (q.tipo === "multipla_escolha") {
      const ul = el("ul", "space-y-1");
      (q.alternativas || []).forEach((alt) => {
        const correta = alt.letra === q.gabarito;
        const li = el("li", correta ? "rounded-lg bg-petroleo-claro p-2 font-bold" : "p-2", `${alt.letra}) ${alt.texto}`);
        if (correta) li.appendChild(document.createTextNode(" (correta)"));
        ul.appendChild(li);
      });
      conteudo.appendChild(ul);
    } else {
      const esperada = el("p", "rounded-lg bg-petroleo-claro p-3 whitespace-pre-wrap");
      esperada.appendChild(el("strong", "", "Resposta esperada: "));
      esperada.appendChild(document.createTextNode(q.gabarito || ""));
      conteudo.appendChild(esperada);
    }

    const just = el("p", "whitespace-pre-wrap");
    just.appendChild(el("strong", "", "Justificativa: "));
    just.appendChild(document.createTextNode(q.justificativa || ""));
    conteudo.appendChild(just);

    if (q.habilidade) {
      const hab = el("p");
      hab.appendChild(el("strong", "", "Habilidade: "));
      hab.appendChild(document.createTextNode(q.habilidade));
      conteudo.appendChild(hab);
    }

    conteudo.appendChild(el("p", "border-t border-[#E3E9EE] pt-3 text-sm text-[#4B5C6B]", linhaAuditoria(q)));
    detalhes.appendChild(conteudo);
    item.appendChild(detalhes);

    // Ações
    const acoes = el("div", "mt-4 flex flex-wrap gap-2");
    const botao = (texto, classes, aoClicar) => {
      const b = el("button", `rounded-[10px] px-4 py-2 font-bold ${classes}`, texto);
      b.type = "button";
      b.addEventListener("click", aoClicar);
      acoes.appendChild(b);
    };

    if (ehSupervisor && q.statusValidacao !== "aprovada") {
      botao("Aprovar", "bg-petroleo text-white hover:bg-petroleo-escuro", () => aprovar(q));
    }
    if (ehSupervisor && q.statusValidacao !== "rejeitada") {
      botao("Devolver", "border-2 border-alerta text-alerta hover:bg-[#FBE9E4]", () => devolver(q));
    }
    if (ehDono || ehSupervisor) {
      botao("Editar", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => ctx.aoEditar(q));
      botao("Excluir", "border-2 border-[#9FB0BE] text-alerta hover:bg-[#FBE9E4]", () => excluir(q));
    }
    if (acoes.children.length > 0) item.appendChild(acoes);

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
        ? "O Firestore recusou a leitura. Confira se publicou as regras do arquivo firestore.rules."
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
      ctx.aoAlterar();
      await carregar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível aprovar a questão.", "erro");
    }
  }

  async function devolver(q) {
    const resposta = await perguntar({
      titulo: "Devolver questão ao autor",
      texto: "A questão sai do Banco Oficial e o autor vê o motivo que você escrever.",
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
      ctx.aviso("Questão devolvida ao autor.");
      ctx.aoAlterar();
      await carregar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível devolver a questão.", "erro");
    }
  }

  async function excluir(q) {
    const resposta = await perguntar({
      titulo: "Excluir questão",
      texto: `Excluir a questão sobre “${q.assunto}”? Essa ação não pode ser desfeita.`,
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
      ctx.aoAlterar();
      await carregar();
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
  $("#b-minhas", area).addEventListener("change", (ev) => { filtros.soMinhas = ev.target.checked; aoMudarFiltro(); });

  $("#b-limpar-filtros", area).addEventListener("click", () => {
    Object.assign(filtros, {
      busca: "", segmento: "", ano: "", disciplina: "", bimestre: "",
      tipo: "", dificuldade: "", status: "", soMinhas: false
    });
    $("#b-busca", area).value = "";
    selSegmento.value = "";
    preencherAnoEDisciplina();
    ["#b-bimestre", "#b-tipo", "#b-dificuldade", "#b-status"].forEach((id) => { $(id, area).value = ""; });
    $("#b-minhas", area).checked = false;
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
