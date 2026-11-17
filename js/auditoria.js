import {
  collection, getDocs, query, where, orderBy, limit, startAfter
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { $, el, normalizar, formatarData, rotuloCargo } from "./util.js";
import { TIPOS } from "./curriculo.js";

const LOTE = 300;      // registros buscados por vez no servidor
const POR_PAGINA = 40; // registros mostrados por vez na tela

// código da ação → [texto em português, categoria, pede atenção?]
const ACOES = {
  login: ["Entrou no sistema", "acesso"],
  logout: ["Saiu do sistema", "acesso"],
  sessao_expirada: ["Sessão encerrada por inatividade", "acesso"],
  conta_criada: ["Criou a própria conta", "equipe"],
  conta_ativada: ["Liberou uma conta", "equipe"],
  conta_desativada: ["Desativou uma conta", "equipe", true],
  cargo_alterado: ["Alterou o cargo de alguém", "equipe", true],
  responsabilidade_transferida: ["Transferiu questões para outra pessoa", "equipe", true],
  backup_exportado: ["Baixou o backup do banco", "equipe", true],
  auditoria_exportada: ["Baixou a planilha da auditoria", "equipe", true],
  questao_criada: ["Criou uma questão", "questoes"],
  questao_versao_criada: ["Criou uma nova versão de questão", "questoes"],
  questao_editada: ["Editou uma questão", "questoes"],
  questao_aprovada: ["Aprovou uma questão", "questoes"],
  questao_devolvida: ["Devolveu uma questão", "questoes"],
  questao_arquivada: ["Arquivou uma questão", "questoes"],
  questao_restaurada: ["Restaurou uma questão", "questoes"],
  questao_excluida: ["Excluiu uma questão", "questoes", true],
  texto_apoio_criado: ["Criou um texto de apoio", "questoes"],
  prova_salva: ["Salvou uma prova", "provas"],
  prova_atualizada: ["Atualizou uma prova salva", "provas"],
  prova_excluida: ["Excluiu uma prova salva", "provas"],
  prova_impressa: ["Imprimiu uma prova", "provas"],
  gabarito_impresso: ["Imprimiu um gabarito", "provas"],
  adaptacao_gerada_ia: ["Pediu uma adaptação à IA", "ia"],
  importacao_lida: ["Enviou um arquivo para a IA ler", "ia"],
  importacao_concluida: ["Terminou uma importação", "ia"]
};

const CATEGORIAS = {
  acesso: "Acesso",
  questoes: "Questões",
  provas: "Provas",
  ia: "Inteligência artificial",
  equipe: "Equipe e segurança",
  outros: "Outros"
};

const COR_CATEGORIA = {
  acesso: "border-[#B9C4CE] text-[#33475B]",
  questoes: "border-petroleo bg-petroleo-claro text-petroleo-escuro",
  provas: "border-[#7A6BB0] bg-[#F0EDFA] text-[#4A3F80]",
  ia: "border-marca bg-[#FFF6DB] text-[#6B4E00]",
  equipe: "border-[#B84A32] bg-[#FBE9E4] text-[#8A3420]",
  outros: "border-[#B9C4CE] text-[#33475B]"
};

// campo dos detalhes → rótulo. Os códigos internos (ids) ficam de fora da leitura.
const ROTULOS = {
  titulo: "Título", disciplina: "Disciplina", ano: "Ano", segmento: "Segmento", bimestre: "Bimestre",
  assunto: "Assunto", tipo: "Tipo", questoes: "Questões", semValidacao: "Sem validação",
  motivo: "Motivo", usuarioAfetado: "Pessoa", email: "E-mail", de: "De", para: "Para",
  quantidade: "Quantidade", arquivo: "Arquivo", partes: "Partes", partesLidas: "Partes lidas",
  salvas: "Salvas", puladas: "Puladas", modo: "Modo", reduziu: "Reduziu as alternativas",
  adaptacao: "Adaptação", origem: "Origem", autor: "Autor", imagens: "Imagens", linhas: "Linhas"
};
const OCULTOS = ["questaoId", "provaId", "textoApoioId", "derivadaDeId", "usuarioUid"];

const VALORES = {
  tea: "TEA", nao_leitor: "Não leitor", manual: "Digitada", importada: "Importada",
  fundamental: "Ensino Fundamental", medio: "Ensino Médio", professor: "Professor(a)", supervisor: "Supervisor(a)"
};

function textoDoValor(valor) {
  if (valor === true) return "sim";
  if (valor === false) return "não";
  if (valor === null || valor === undefined || valor === "") return "";
  if (typeof valor === "object") return JSON.stringify(valor);
  return VALORES[valor] || TIPOS[valor] || String(valor);
}

function descreverDetalhes(detalhes) {
  const linhas = [];
  Object.entries(detalhes || {}).forEach(([chave, valor]) => {
    if (OCULTOS.includes(chave)) return;
    const texto = textoDoValor(valor);
    if (texto === "") return;
    linhas.push([ROTULOS[chave] || chave, texto]);
  });
  return linhas;
}

const infoDaAcao = (codigo) => ACOES[codigo] || [codigo, "outros"];

function celulaCsv(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

export function iniciarAuditoria(ctx) {
  const area = document.getElementById("area-auditoria");
  if (!area) return { carregar() {}, limpar() {}, filtrarPorQuestao() {} };

  let eventos = [];
  let ultimoDoc = null;
  let haMais = false;
  let usuarios = [];
  let visiveis = POR_PAGINA;
  let carregando = false;

  const filtros = { periodo: "7", de: "", ate: "", pessoa: "", categoria: "", acao: "", busca: "", questaoId: "", questaoRotulo: "" };

  const opcoesAcao = Object.entries(ACOES)
    .map(([codigo, [texto]]) => `<option value="${codigo}">${texto}</option>`).join("");

  area.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Auditoria</h1>
        <p class="mt-1 text-[#33475B]">Registro do que acontece no sistema. Os registros não podem ser alterados nem apagados.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" id="au-csv" class="rounded-[10px] bg-petroleo px-4 py-2 font-bold text-white hover:bg-petroleo-escuro">Baixar planilha (CSV)</button>
        <button type="button" id="au-atualizar" class="rounded-[10px] border-2 border-petroleo px-4 py-2 font-bold text-petroleo hover:bg-petroleo-claro">Atualizar</button>
      </div>
    </div>

    <div id="au-questao" class="mt-4 hidden flex-col gap-2 rounded-xl border-2 border-marca bg-[#FFF6DB] p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <p class="font-bold">Histórico da questão: <span id="au-questao-nome"></span></p>
      <button type="button" id="au-todos" class="rounded-[10px] border-2 border-[#9FB0BE] bg-white px-4 py-2 font-bold text-[#33475B]">Ver todos os registros</button>
    </div>

    <section class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4" aria-label="Filtros">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label class="rotulo" for="au-periodo">Período</label>
          <select id="au-periodo" class="campo">
            <option value="hoje">Hoje</option>
            <option value="7" selected>Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="tudo">Todo o período</option>
            <option value="datas">Escolher datas</option>
          </select>
        </div>
        <div id="au-datas" class="hidden grid-cols-2 gap-3 sm:col-span-1 lg:col-span-2">
          <div>
            <label class="rotulo" for="au-de">De</label>
            <input id="au-de" type="date" class="campo">
          </div>
          <div>
            <label class="rotulo" for="au-ate">Até</label>
            <input id="au-ate" type="date" class="campo">
          </div>
        </div>
        <div>
          <label class="rotulo" for="au-pessoa">Pessoa</label>
          <select id="au-pessoa" class="campo"><option value="">Todas</option></select>
        </div>
        <div>
          <label class="rotulo" for="au-categoria">Tipo de registro</label>
          <select id="au-categoria" class="campo">
            <option value="">Todos</option>
            ${Object.entries(CATEGORIAS).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="rotulo" for="au-acao">Ação</label>
          <select id="au-acao" class="campo"><option value="">Todas</option>${opcoesAcao}</select>
        </div>
        <div class="sm:col-span-2 lg:col-span-3">
          <label class="rotulo" for="au-busca">Buscar nos detalhes</label>
          <input id="au-busca" type="search" class="campo" placeholder="Assunto, disciplina, título da prova, nome…" autocomplete="off">
        </div>
      </div>
    </section>

    <p id="au-resumo" class="mt-4 font-bold text-[#33475B]" aria-live="polite"></p>
    <div id="au-chips" class="mt-2 flex flex-wrap gap-2"></div>
    <div id="au-estado" class="mt-4"></div>
    <ul id="au-lista" class="mt-4 space-y-2"></ul>
    <div class="mt-5 flex flex-col items-center gap-3">
      <button type="button" id="au-mais" class="hidden rounded-[10px] border-2 border-petroleo px-5 py-2.5 font-bold text-petroleo hover:bg-petroleo-claro">Mostrar mais registros</button>
      <button type="button" id="au-antigos" class="hidden rounded-[10px] border-2 border-[#9FB0BE] px-5 py-2.5 font-bold text-[#33475B] hover:bg-giz">Buscar registros mais antigos</button>
    </div>
  `;

  // ----- Período -----
  function intervalo() {
    const hoje = new Date();
    const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    if (filtros.periodo === "hoje") return { inicio: inicioDoDia(hoje), fim: null };
    if (filtros.periodo === "7" || filtros.periodo === "30") {
      const d = new Date(hoje);
      d.setDate(d.getDate() - Number(filtros.periodo));
      return { inicio: inicioDoDia(d), fim: null };
    }
    if (filtros.periodo === "datas") {
      const inicio = filtros.de ? new Date(`${filtros.de}T00:00:00`) : null;
      const fim = filtros.ate ? new Date(`${filtros.ate}T23:59:59.999`) : null;
      return { inicio, fim };
    }
    return { inicio: null, fim: null };
  }

  function mostrarMensagem(texto, tipo = "info") {
    const caixa = $("#au-estado", area);
    caixa.replaceChildren();
    if (!texto) return;
    const classes = tipo === "erro"
      ? "rounded-xl bg-[#FBE9E4] p-4 font-bold text-alerta"
      : "rounded-xl bg-white border border-[#D5DDE4] p-4 font-bold text-[#33475B]";
    const p = el("p", classes, texto);
    p.setAttribute("role", tipo === "erro" ? "alert" : "status");
    caixa.appendChild(p);
  }

  // ----- Carregamento -----
  async function carregarUsuarios() {
    try {
      const snap = await getDocs(collection(ctx.db, "users"));
      usuarios = snap.docs.map((d) => ({ id: d.id, nome: d.data().nome || "Sem nome", cargo: d.data().cargo }));
    } catch (e) {
      console.warn("Lista de pessoas indisponível:", e);
    }
  }

  function atualizarListaDePessoas() {
    const select = $("#au-pessoa", area);
    const atual = filtros.pessoa;
    const mapa = new Map(usuarios.map((u) => [u.id, u.nome]));
    eventos.forEach((e) => { if (e.usuarioUid && !mapa.has(e.usuarioUid)) mapa.set(e.usuarioUid, e.usuarioNome || "Sem nome"); });
    select.replaceChildren();
    const todas = document.createElement("option");
    todas.value = "";
    todas.textContent = "Todas";
    select.appendChild(todas);
    [...mapa.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR")).forEach(([uid, nome]) => {
      const op = document.createElement("option");
      op.value = uid;
      op.textContent = nome;
      select.appendChild(op);
    });
    select.value = mapa.has(atual) ? atual : "";
    filtros.pessoa = select.value;
  }

  const tempoDe = (e) => (e.em && typeof e.em.toDate === "function" ? e.em.toDate().getTime() : Date.now());

  async function carregar(maisAntigos = false) {
    if (!ctx.estado.usuario || ctx.estado.perfil.cargo !== "supervisor" || carregando) return;
    carregando = true;
    const botaoAntigos = $("#au-antigos", area);
    botaoAntigos.disabled = true;
    if (!maisAntigos) {
      eventos = [];
      ultimoDoc = null;
      visiveis = POR_PAGINA;
      mostrarMensagem("Carregando registros…");
      if (usuarios.length === 0) await carregarUsuarios();
    }

    try {
      const col = collection(ctx.db, "auditoria");
      let consulta;
      if (filtros.questaoId) {
        consulta = query(col, where("detalhes.questaoId", "==", filtros.questaoId), limit(LOTE));
      } else {
        const { inicio, fim } = intervalo();
        const regras = [];
        if (inicio) regras.push(where("em", ">=", inicio));
        if (fim) regras.push(where("em", "<=", fim));
        regras.push(orderBy("em", "desc"));
        if (maisAntigos && ultimoDoc) regras.push(startAfter(ultimoDoc));
        regras.push(limit(LOTE));
        consulta = query(col, ...regras);
      }
      const snap = await getDocs(consulta);
      const novos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      eventos = maisAntigos ? [...eventos, ...novos] : novos;
      eventos.sort((a, b) => tempoDe(b) - tempoDe(a));
      ultimoDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : ultimoDoc;
      haMais = !filtros.questaoId && snap.docs.length >= LOTE;
      mostrarMensagem("");
      atualizarListaDePessoas();
      desenhar();
    } catch (e) {
      console.error(e);
      mostrarMensagem(e && e.code === "permission-denied"
        ? "O Firestore recusou a leitura. Só Supervisores acessam a auditoria."
        : "Não foi possível carregar a auditoria. Verifique a conexão e toque em Atualizar.", "erro");
    } finally {
      carregando = false;
      botaoAntigos.disabled = false;
    }
  }

  // ----- Filtros no navegador -----
  function filtrar() {
    const busca = normalizar(filtros.busca);
    return eventos.filter((e) => {
      const [, categoria] = infoDaAcao(e.acao);
      if (filtros.pessoa && e.usuarioUid !== filtros.pessoa) return false;
      if (filtros.categoria && categoria !== filtros.categoria) return false;
      if (filtros.acao && e.acao !== filtros.acao) return false;
      if (busca) {
        const texto = normalizar([e.usuarioNome, infoDaAcao(e.acao)[0], descreverDetalhes(e.detalhes).map((l) => l.join(" ")).join(" ")].join(" "));
        if (!texto.includes(busca)) return false;
      }
      return true;
    });
  }

  // ----- Desenho -----
  function criarItem(e) {
    const [texto, categoria, atencao] = infoDaAcao(e.acao);
    const item = el("li", "rounded-xl border bg-white p-3 " + (atencao ? "border-[#E3B5A8]" : "border-[#D5DDE4]"));

    const topo = el("div", "flex flex-wrap items-center gap-2");
    topo.appendChild(el("span", `rounded-full border px-3 py-0.5 text-xs font-bold ${COR_CATEGORIA[categoria] || COR_CATEGORIA.outros}`, CATEGORIAS[categoria] || "Outros"));
    if (atencao) topo.appendChild(el("span", "rounded-full border border-marca bg-[#FFF6DB] px-3 py-0.5 text-xs font-bold text-[#6B4E00]", "Atenção"));
    topo.appendChild(el("span", "text-sm text-[#4B5C6B]", formatarData(e.em)));
    item.appendChild(topo);

    item.appendChild(el("p", "mt-1 font-bold", texto));
    item.appendChild(el("p", "text-sm text-[#33475B]", `${e.usuarioNome || "Pessoa desconhecida"} (${rotuloCargo(e.cargo)})`));

    const linhas = descreverDetalhes(e.detalhes);
    if (linhas.length) {
      const lista = el("dl", "mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2");
      linhas.forEach(([rotulo, valor]) => {
        const par = el("div", "flex gap-1");
        par.appendChild(el("dt", "font-bold text-[#4B5C6B]", `${rotulo}:`));
        par.appendChild(el("dd", "min-w-0 break-words", valor));
        lista.appendChild(par);
      });
      item.appendChild(lista);
    }
    return item;
  }

  function desenhar() {
    const resultado = filtrar();
    const lista = $("#au-lista", area);
    lista.replaceChildren();

    const pessoas = new Set(resultado.map((e) => e.usuarioUid)).size;
    $("#au-resumo", area).textContent =
      `${resultado.length} registro(s) de ${pessoas} pessoa(s)${eventos.length !== resultado.length ? ` (${eventos.length} carregados)` : ""}.`;

    const chips = $("#au-chips", area);
    chips.replaceChildren();
    const contagem = {};
    resultado.forEach((e) => { const c = infoDaAcao(e.acao)[1]; contagem[c] = (contagem[c] || 0) + 1; });
    Object.entries(contagem).forEach(([cat, n]) => {
      chips.appendChild(el("span", `rounded-full border px-3 py-1 text-sm font-bold ${COR_CATEGORIA[cat] || COR_CATEGORIA.outros}`, `${CATEGORIAS[cat] || "Outros"}: ${n}`));
    });

    if (resultado.length === 0) {
      lista.appendChild(el("li", "rounded-xl border border-dashed border-[#9FB0BE] bg-white p-5 text-[#33475B]",
        eventos.length === 0 ? "Nenhum registro neste período." : "Nenhum registro com estes filtros."));
    }
    resultado.slice(0, visiveis).forEach((e) => lista.appendChild(criarItem(e)));
    $("#au-mais", area).classList.toggle("hidden", resultado.length <= visiveis);
    $("#au-antigos", area).classList.toggle("hidden", !haMais);
  }

  // ----- Planilha -----
  async function baixarCsv() {
    const resultado = filtrar();
    if (resultado.length === 0) { ctx.aviso("Não há registros para baixar com estes filtros.", "erro"); return; }

    const cabecalho = ["Data e hora", "Pessoa", "Cargo", "Tipo de registro", "Ação", "Detalhes", "Código da ação"];
    const linhas = resultado.map((e) => {
      const [texto, categoria] = infoDaAcao(e.acao);
      const detalhes = descreverDetalhes(e.detalhes).map(([r, v]) => `${r}: ${v}`).join(" | ");
      return [formatarData(e.em), e.usuarioNome || "", rotuloCargo(e.cargo), CATEGORIAS[categoria] || "Outros", texto, detalhes, e.acao || ""];
    });
    // Ponto e vírgula e BOM para abrir direto no Excel em português.
    const texto = "\ufeff" + [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(";")).join("\r\n");
    const arquivo = new Blob([texto], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");
    link.href = url;
    link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    try {
      await ctx.registrarAuditoria("auditoria_exportada", { quantidade: resultado.length });
    } catch (e) {
      console.warn(e);
    }
    ctx.aviso(`Planilha com ${resultado.length} registro(s) baixada.`);
  }

  // ----- Histórico de uma questão -----
  function filtrarPorQuestao(questao) {
    Object.assign(filtros, { periodo: "tudo", de: "", ate: "", pessoa: "", categoria: "", acao: "", busca: "", questaoId: questao.id, questaoRotulo: questao.assunto || "sem assunto" });
    sincronizarCampos();
  }

  function sincronizarCampos() {
    $("#au-periodo", area).value = filtros.periodo;
    $("#au-de", area).value = filtros.de;
    $("#au-ate", area).value = filtros.ate;
    $("#au-datas", area).classList.toggle("hidden", filtros.periodo !== "datas");
    $("#au-datas", area).classList.toggle("grid", filtros.periodo === "datas");
    $("#au-categoria", area).value = filtros.categoria;
    $("#au-acao", area).value = filtros.acao;
    $("#au-busca", area).value = filtros.busca;
    const caixa = $("#au-questao", area);
    caixa.classList.toggle("hidden", !filtros.questaoId);
    caixa.classList.toggle("flex", Boolean(filtros.questaoId));
    $("#au-questao-nome", area).textContent = filtros.questaoRotulo;
  }

  function limpar() {
    eventos = [];
    usuarios = [];
    ultimoDoc = null;
    haMais = false;
    $("#au-lista", area).replaceChildren();
    $("#au-chips", area).replaceChildren();
    $("#au-resumo", area).textContent = "";
  }

  // ----- Eventos -----
  $("#au-periodo", area).addEventListener("change", (ev) => {
    filtros.periodo = ev.target.value;
    sincronizarCampos();
    if (filtros.periodo !== "datas") carregar();
  });
  const aoMudarData = () => { filtros.de = $("#au-de", area).value; filtros.ate = $("#au-ate", area).value; carregar(); };
  $("#au-de", area).addEventListener("change", aoMudarData);
  $("#au-ate", area).addEventListener("change", aoMudarData);

  const aoFiltrar = () => { visiveis = POR_PAGINA; desenhar(); };
  $("#au-pessoa", area).addEventListener("change", (ev) => { filtros.pessoa = ev.target.value; aoFiltrar(); });
  $("#au-categoria", area).addEventListener("change", (ev) => { filtros.categoria = ev.target.value; aoFiltrar(); });
  $("#au-acao", area).addEventListener("change", (ev) => { filtros.acao = ev.target.value; aoFiltrar(); });
  $("#au-busca", area).addEventListener("input", (ev) => { filtros.busca = ev.target.value; aoFiltrar(); });
  $("#au-mais", area).addEventListener("click", () => { visiveis += POR_PAGINA; desenhar(); });
  $("#au-antigos", area).addEventListener("click", () => carregar(true));
  $("#au-atualizar", area).addEventListener("click", () => carregar());
  $("#au-csv", area).addEventListener("click", baixarCsv);
  $("#au-todos", area).addEventListener("click", () => {
    Object.assign(filtros, { questaoId: "", questaoRotulo: "", periodo: "7" });
    sincronizarCampos();
    carregar();
  });

  window.addEventListener("hashchange", () => {
    if (location.hash === "#auditoria") carregar();
  });

  return { carregar, limpar, filtrarPorQuestao };
}
