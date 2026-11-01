import {
  collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SEGMENTOS, BIMESTRES, DIFICULDADES, TIPOS } from "./curriculo.js";
import { $, el, normalizar, formatarData } from "./util.js";
import { renderRico } from "./rico.js";
import { perguntar } from "./dialogo.js";
import { renderizarProva, renderizarGabarito, formatarValor } from "./prova-render.js";
import { escola } from "./firebase-config.js";

const POR_PAGINA = 15;
const INSTRUCOES_PADRAO = "Leia com atenção cada questão antes de responder.\nUse caneta azul ou preta.\nNão é permitido o uso de aparelhos eletrônicos.";

const ordemDificuldade = ["facil", "media", "dificil"];

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Agrupa questões que usam o mesmo texto de apoio, mantendo a ordem do primeiro aparecimento.
function agruparGrupos(itens) {
  const grupos = [];
  const mapa = new Map();
  itens.forEach((item) => {
    const chave = item.q.textoApoioId;
    if (chave && mapa.has(chave)) {
      mapa.get(chave).push(item);
    } else {
      const grupo = [item];
      grupos.push(grupo);
      if (chave) mapa.set(chave, grupo);
    }
  });
  return grupos;
}

const agruparPorApoio = (itens) => agruparGrupos(itens).flat();
const embaralharGrupos = (itens) => embaralhar(agruparGrupos(itens)).flat();

export function iniciarProvas(ctx) {
  const area = document.getElementById("area-provas");
  if (!area) return { carregarSalvas() {}, limpar() {} };

  let pool = [];
  let selecionadas = []; // [{ q, valor }]
  let visiveis = POR_PAGINA;
  let provaSalvaId = null;
  let contexto = null; // { segmento, ano, disciplina, bimestre, incluirPendentes }
  let salvas = [];
  let tokenPrevia = 0;

  const filtros = { assunto: "", dificuldade: "", tipo: "", adaptacao: "", busca: "" };

  const opcoes = (itens, vazio) =>
    `<option value="">${vazio}</option>` + itens.map((i) => `<option value="${i.valor}">${i.rotulo}</option>`).join("");

  area.innerHTML = `
    <h1 class="text-2xl font-bold sm:text-3xl">Gerar prova</h1>
    <p class="mt-1 text-[#33475B]">Escolha as questões, monte o cabeçalho e imprima ou salve em PDF. Por padrão, só entram questões do Banco Oficial.</p>

    <details class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4" id="p-salvas-caixa">
      <summary class="cursor-pointer font-bold text-petroleo">Provas salvas</summary>
      <div id="p-salvas" class="mt-3"></div>
    </details>

    <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
      <legend class="px-1 text-lg font-bold">1. Para quem é a prova</legend>
      <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="rotulo" for="p-segmento">Segmento</label>
          <select id="p-segmento" class="campo">${opcoes(
            Object.entries(SEGMENTOS).map(([valor, s]) => ({ valor, rotulo: s.rotulo })), "Selecione o segmento")}</select>
        </div>
        <div>
          <label class="rotulo" for="p-ano">Ano / série</label>
          <select id="p-ano" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
        </div>
        <div>
          <label class="rotulo" for="p-disciplina">Disciplina</label>
          <select id="p-disciplina" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
        </div>
        <div>
          <label class="rotulo" for="p-bimestre">Bimestre</label>
          <select id="p-bimestre" class="campo">${opcoes(
            BIMESTRES.map((n) => ({ valor: String(n), rotulo: `${n}º bimestre` })), "Todos os bimestres")}</select>
        </div>
        <label class="flex items-center gap-3 font-bold sm:col-span-2">
          <input id="p-pendentes" type="checkbox" class="h-5 w-5 accent-[#0F6B6B]">
          Incluir também questões aguardando validação
        </label>
      </div>
      <p id="p-erro1" class="mt-3 hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>
      <button type="button" id="p-buscar" class="btn mt-4 sm:!w-auto sm:min-w-[14rem]">Buscar questões</button>
    </fieldset>

    <div id="p-passos" class="hidden">

      <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">2. Escolha as questões</legend>

        <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="rotulo" for="p-f-assunto">Assunto</label>
            <select id="p-f-assunto" class="campo"></select>
          </div>
          <div>
            <label class="rotulo" for="p-f-dif">Dificuldade</label>
            <select id="p-f-dif" class="campo">${opcoes(
              Object.entries(DIFICULDADES).map(([valor, rotulo]) => ({ valor, rotulo })), "Todas")}</select>
          </div>
          <div>
            <label class="rotulo" for="p-f-tipo">Tipo</label>
            <select id="p-f-tipo" class="campo">${opcoes(
              Object.entries(TIPOS).map(([valor, rotulo]) => ({ valor, rotulo })), "Todos")}</select>
          </div>
          <div>
            <label class="rotulo" for="p-f-adapt">Versão da questão</label>
            <select id="p-f-adapt" class="campo">
              <option value="">Todas</option>
              <option value="nenhuma">Sem adaptação</option>
              <option value="tea">Adaptada para TEA</option>
              <option value="nao_leitor">Adaptada para não leitores</option>
            </select>
          </div>
          <div>
            <label class="rotulo" for="p-f-busca">Buscar por texto</label>
            <input id="p-f-busca" type="search" class="campo" autocomplete="off">
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-[#E3E9EE] p-3">
          <p class="font-bold">Sortear questões</p>
          <p class="text-sm text-[#4B5C6B]">Sorteia entre as questões que aparecem com os filtros acima e ainda não estão na prova.</p>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label class="rotulo" for="p-s-facil">Fáceis</label>
              <input id="p-s-facil" type="number" min="0" max="50" value="0" class="campo">
            </div>
            <div>
              <label class="rotulo" for="p-s-media">Médias</label>
              <input id="p-s-media" type="number" min="0" max="50" value="0" class="campo">
            </div>
            <div>
              <label class="rotulo" for="p-s-dificil">Difíceis</label>
              <input id="p-s-dificil" type="number" min="0" max="50" value="0" class="campo">
            </div>
          </div>
          <button type="button" id="p-sortear" class="mt-3 rounded-[10px] border-2 border-petroleo px-4 py-2 font-bold text-petroleo hover:bg-petroleo-claro">Sortear e adicionar</button>
        </div>

        <p id="p-contagem" class="mt-4 text-sm font-bold text-[#33475B]" aria-live="polite"></p>
        <ul id="p-pool" class="mt-3 space-y-3"></ul>
        <div class="mt-4 text-center"><button type="button" id="p-mais" class="hidden rounded-[10px] border-2 border-petroleo px-5 py-2.5 font-bold text-petroleo hover:bg-petroleo-claro">Mostrar mais questões</button></div>
      </fieldset>

      <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">3. Montagem da prova</legend>
        <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="rotulo" for="p-valortotal">Valor total da prova</label>
            <input id="p-valortotal" type="number" min="0" step="0.5" value="10" class="campo">
          </div>
          <label class="flex items-center gap-3 font-bold sm:pt-7">
            <input id="p-dividir" type="checkbox" class="h-5 w-5 accent-[#0F6B6B]" checked>
            Dividir o valor igualmente
          </label>
        </div>
        <ol id="p-selecionadas" class="mt-4 space-y-2"></ol>
        <p id="p-resumo" class="mt-3 text-sm font-bold text-[#33475B]" aria-live="polite"></p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" id="p-embaralhar" class="rounded-[10px] border-2 border-[#9FB0BE] px-4 py-2 font-bold text-[#33475B] hover:bg-giz">Embaralhar ordem</button>
          <button type="button" id="p-limpar-sel" class="rounded-[10px] border-2 border-[#9FB0BE] px-4 py-2 font-bold text-alerta hover:bg-[#FBE9E4]">Remover todas</button>
        </div>
      </fieldset>

      <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">4. Cabeçalho e opções</legend>
        <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="rotulo" for="p-titulo">Título da prova</label>
            <input id="p-titulo" type="text" class="campo" maxlength="120" autocomplete="off">
          </div>
          <div>
            <label class="rotulo" for="p-professor">Professor(a)</label>
            <input id="p-professor" type="text" class="campo" maxlength="120" autocomplete="off">
          </div>
          <div>
            <label class="rotulo" for="p-turma">Turma (opcional)</label>
            <input id="p-turma" type="text" class="campo" maxlength="30" autocomplete="off" placeholder="Ex.: 7º A">
          </div>
          <div>
            <label class="rotulo" for="p-data">Data da prova (opcional)</label>
            <input id="p-data" type="date" class="campo">
          </div>
          <div>
            <label class="rotulo" for="p-linhas">Linhas para resposta nas discursivas</label>
            <input id="p-linhas" type="number" min="0" max="20" value="5" class="campo">
          </div>
          <div class="sm:col-span-2">
            <label class="rotulo" for="p-instrucoes">Instruções para o aluno</label>
            <textarea id="p-instrucoes" rows="3" maxlength="600" class="campo"></textarea>
          </div>
          <label class="flex items-start gap-3 font-bold sm:col-span-2">
            <input id="p-acessivel" type="checkbox" class="mt-1 h-5 w-5 accent-[#0F6B6B]">
            <span>Formato com letra maior e espaçamento duplo
              <span class="block text-sm font-normal text-[#4B5C6B]">Fonte legível em 14 pontos, mais espaço entre as linhas e as alternativas. Ajuda leitores iniciantes e alunos com dificuldade de atenção.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">5. Prévia, impressão e PDF</legend>
        <p id="p-erro5" class="mt-2 hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>
        <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" id="p-previa-btn" class="rounded-[10px] border-2 border-petroleo px-5 py-3 font-bold text-petroleo hover:bg-petroleo-claro">Atualizar prévia</button>
          <button type="button" id="p-imprimir" class="btn sm:!w-auto">Imprimir prova ou salvar em PDF</button>
          <button type="button" id="p-gabarito" class="rounded-[10px] border-2 border-petroleo px-5 py-3 font-bold text-petroleo hover:bg-petroleo-claro">Imprimir gabarito</button>
          <button type="button" id="p-salvar" class="rounded-[10px] border-2 border-[#9FB0BE] px-5 py-3 font-bold text-[#33475B] hover:bg-giz">Salvar esta prova</button>
        </div>
        <p class="mt-3 text-sm text-[#4B5C6B]">Na janela de impressão, escolha “Salvar como PDF” como destino para gerar o arquivo.</p>
        <div id="p-previa" class="folha mt-4 hidden overflow-x-auto rounded-lg border border-[#B9C4CE] p-5"></div>
      </fieldset>
    </div>
  `;

  const selSegmento = $("#p-segmento", area);
  const selAno = $("#p-ano", area);
  const selDisciplina = $("#p-disciplina", area);

  // ----- Utilidades -----
  function mostrarErro(id, texto) {
    const caixa = $(id, area);
    caixa.textContent = texto || "";
    caixa.classList.toggle("hidden", !texto);
  }

  function preencher(select, itens, vazio) {
    select.innerHTML = `<option value="">${vazio}</option>` + itens.map((i) => `<option value="${i}">${i}</option>`).join("");
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

  const dividirIgual = () => $("#p-dividir", area).checked;
  const valorTotal = () => Math.max(0, Number($("#p-valortotal", area).value) || 0);

  function recalcularValores() {
    if (!dividirIgual() || selecionadas.length === 0) return;
    const n = selecionadas.length;
    const base = Math.floor((valorTotal() / n) * 100) / 100;
    selecionadas.forEach((item) => { item.valor = base; });
    const resto = Math.round((valorTotal() - base * n) * 100) / 100;
    selecionadas[n - 1].valor = Math.round((base + resto) * 100) / 100;
  }

  // ----- Banco de candidatas -----
  async function carregarPool(preservarSelecao = false) {
    mostrarErro("#p-erro1", "");
    const segmento = selSegmento.value;
    const ano = selAno.value;
    const disciplina = selDisciplina.value;
    const bimestre = $("#p-bimestre", area).value;
    const incluirPendentes = $("#p-pendentes", area).checked;

    if (!segmento || !ano || !disciplina) {
      mostrarErro("#p-erro1", "Escolha o segmento, o ano e a disciplina.");
      return false;
    }

    const botao = $("#p-buscar", area);
    botao.disabled = true;
    botao.textContent = "Buscando…";
    try {
      const snap = await getDocs(query(collection(ctx.db, "questoes"), where("disciplina", "==", disciplina), limit(500)));
      pool = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((q) =>
          q.segmento === segmento &&
          q.ano === ano &&
          !q.arquivada &&
          (!bimestre || String(q.bimestre) === bimestre) &&
          (q.statusValidacao === "aprovada" || (incluirPendentes && q.statusValidacao === "pendente"))
        )
        .sort((a, b) => String(a.assunto).localeCompare(String(b.assunto), "pt-BR"));

      const mudou = !contexto || contexto.segmento !== segmento || contexto.ano !== ano || contexto.disciplina !== disciplina;
      if (!preservarSelecao && mudou && selecionadas.length > 0) {
        selecionadas = [];
        ctx.aviso("A seleção anterior foi limpa porque a turma ou a disciplina mudou.");
      }
      contexto = { segmento, ano, disciplina, bimestre, incluirPendentes };

      if (!$("#p-titulo", area).value.trim() || (!preservarSelecao && mudou)) {
        $("#p-titulo", area).value = `Avaliação de ${disciplina}${bimestre ? ` - ${bimestre}º bimestre` : ""}`;
      }
      if (!$("#p-professor", area).value.trim()) $("#p-professor", area).value = ctx.estado.perfil.nome;
      if (!$("#p-instrucoes", area).value.trim()) $("#p-instrucoes", area).value = INSTRUCOES_PADRAO;

      const assuntos = [...new Set(pool.map((q) => q.assunto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      $("#p-f-assunto", area).innerHTML = `<option value="">Todos</option>` + assuntos.map((a) => `<option value="${a.replace(/"/g, "&quot;")}">${a.replace(/</g, "&lt;")}</option>`).join("");
      Object.assign(filtros, { assunto: "", dificuldade: "", tipo: "", adaptacao: "", busca: "" });
      $("#p-f-adapt", area).value = "";
      $("#p-f-dif", area).value = "";
      $("#p-f-tipo", area).value = "";
      $("#p-f-busca", area).value = "";

      visiveis = POR_PAGINA;
      $("#p-passos", area).classList.remove("hidden");
      aoMudarSelecao();
      return true;
    } catch (e) {
      console.error(e);
      mostrarErro("#p-erro1", e && e.code === "permission-denied"
        ? "O Firestore recusou a leitura. Confira as regras e se sua conta está ativa."
        : "Não foi possível buscar as questões. Verifique a conexão e tente de novo.");
      return false;
    } finally {
      botao.disabled = false;
      botao.textContent = "Buscar questões";
    }
  }

  function filtrarPool() {
    const busca = normalizar(filtros.busca);
    return pool.filter((q) => {
      if (filtros.assunto && q.assunto !== filtros.assunto) return false;
      if (filtros.dificuldade && q.dificuldade !== filtros.dificuldade) return false;
      if (filtros.tipo && q.tipo !== filtros.tipo) return false;
      if (filtros.adaptacao === "nenhuma" && q.adaptacao) return false;
      if (filtros.adaptacao && filtros.adaptacao !== "nenhuma" && q.adaptacao !== filtros.adaptacao) return false;
      if (busca && !normalizar([q.assunto, q.enunciado, q.habilidade].join(" ")).includes(busca)) return false;
      return true;
    });
  }

  const estaNaProva = (q) => selecionadas.some((item) => item.q.id === q.id);

  function alternar(q) {
    const indice = selecionadas.findIndex((item) => item.q.id === q.id);
    if (indice >= 0) {
      selecionadas.splice(indice, 1);
    } else {
      selecionadas.push({ q, valor: 0 });
      selecionadas = agruparPorApoio(selecionadas);
    }
    aoMudarSelecao();
  }

  function criarCartaoPool(q) {
    const dentro = estaNaProva(q);
    const item = el("li", "rounded-xl border p-3 " + (dentro ? "border-petroleo bg-petroleo-claro" : "border-[#D5DDE4] bg-white"));

    const selos = el("div", "flex flex-wrap gap-2");
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-0.5 text-sm font-bold text-[#33475B]", DIFICULDADES[q.dificuldade] || ""));
    selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-0.5 text-sm font-bold text-[#33475B]", TIPOS[q.tipo] || ""));
    if (q.statusValidacao !== "aprovada") {
      selos.appendChild(el("span", "rounded-full border border-marca bg-[#FFF6DB] px-3 py-0.5 text-sm font-bold text-[#6B4E00]", "Aguardando validação"));
    }
    if (q.adaptacao) selos.appendChild(el("span", "rounded-full border border-petroleo bg-petroleo-claro px-3 py-0.5 text-sm font-bold text-petroleo-escuro", q.adaptacao === "tea" ? "Adaptada: TEA" : "Adaptada: não leitor"));
    if (q.textoApoioId) selos.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-0.5 text-sm font-bold text-[#33475B]", "Com texto de apoio"));
    item.appendChild(selos);

    item.appendChild(el("p", "mt-2 font-bold", `${q.assunto || "Sem assunto"} (${q.bimestre}º bimestre)`));
    const previa = el("p", "mt-1 line-clamp-2 whitespace-pre-wrap text-sm");
    renderRico(previa, q.enunciado || "");
    item.appendChild(previa);

    const botao = el("button",
      "mt-3 rounded-[10px] px-4 py-2 font-bold " + (dentro
        ? "border-2 border-alerta text-alerta hover:bg-[#FBE9E4]"
        : "bg-petroleo text-white hover:bg-petroleo-escuro"),
      dentro ? "Remover da prova" : "Adicionar à prova");
    botao.type = "button";
    botao.addEventListener("click", () => alternar(q));
    item.appendChild(botao);
    return item;
  }

  function desenharPool() {
    const lista = $("#p-pool", area);
    lista.replaceChildren();
    const resultado = filtrarPool();
    $("#p-contagem", area).textContent = pool.length === 0
      ? ""
      : `${resultado.length} questão(ões) com estes filtros, de ${pool.length} disponíveis para esta turma.`;

    if (pool.length === 0) {
      lista.appendChild(el("li", "rounded-xl border border-dashed border-[#9FB0BE] p-4 text-[#33475B]",
        "Nenhuma questão disponível para esta turma. Confira se há questões aprovadas ou marque a opção de incluir as que aguardam validação."));
    } else if (resultado.length === 0) {
      lista.appendChild(el("li", "rounded-xl border border-dashed border-[#9FB0BE] p-4 text-[#33475B]", "Nenhuma questão com estes filtros."));
    }
    resultado.slice(0, visiveis).forEach((q) => lista.appendChild(criarCartaoPool(q)));
    $("#p-mais", area).classList.toggle("hidden", resultado.length <= visiveis);
  }

  // ----- Sorteio -----
  function sortear() {
    const pedidos = {
      facil: Number($("#p-s-facil", area).value) || 0,
      media: Number($("#p-s-media", area).value) || 0,
      dificil: Number($("#p-s-dificil", area).value) || 0
    };
    if (pedidos.facil + pedidos.media + pedidos.dificil === 0) {
      ctx.aviso("Informe quantas questões sortear em cada dificuldade.", "erro");
      return;
    }

    const candidatas = filtrarPool().filter((q) => !estaNaProva(q));
    const faltas = [];
    ordemDificuldade.forEach((dif) => {
      const quantidade = pedidos[dif];
      if (!quantidade) return;
      const escolhidas = embaralhar(candidatas.filter((q) => q.dificuldade === dif)).slice(0, quantidade);
      if (escolhidas.length < quantidade) faltas.push(`${DIFICULDADES[dif]}: pediu ${quantidade}, havia ${escolhidas.length}`);
      escolhidas.forEach((q) => selecionadas.push({ q, valor: 0 }));
    });

    selecionadas = agruparPorApoio(selecionadas);
    aoMudarSelecao();
    ctx.aviso(faltas.length ? `Sorteio parcial. ${faltas.join("; ")}.` : "Questões sorteadas e adicionadas.", faltas.length ? "erro" : "ok");
  }

  // ----- Lista da prova -----
  function mover(indice, delta) {
    const destino = indice + delta;
    if (destino < 0 || destino >= selecionadas.length) return;
    [selecionadas[indice], selecionadas[destino]] = [selecionadas[destino], selecionadas[indice]];
    desenharSelecionadas();
  }

  function atualizarResumo() {
    const caixa = $("#p-resumo", area);
    if (selecionadas.length === 0) {
      caixa.textContent = "Nenhuma questão na prova ainda.";
      return;
    }
    const soma = Math.round(selecionadas.reduce((acc, item) => acc + (Number(item.valor) || 0), 0) * 100) / 100;
    const pendentes = selecionadas.filter((item) => item.q.statusValidacao !== "aprovada").length;
    let texto = `${selecionadas.length} questão(ões). Soma dos valores: ${formatarValor(soma)} de ${formatarValor(valorTotal())}.`;
    if (Math.abs(soma - valorTotal()) > 0.001) texto += " A soma é diferente do valor total.";
    if (pendentes > 0) texto += ` Atenção: ${pendentes} questão(ões) ainda não foram validadas.`;
    caixa.textContent = texto;
  }

  function desenharSelecionadas() {
    const lista = $("#p-selecionadas", area);
    lista.replaceChildren();

    selecionadas.forEach((item, i) => {
      const linha = el("li", "rounded-lg border border-[#D5DDE4] p-3");
      const topo = el("div", "flex items-start gap-3");
      topo.appendChild(el("span", "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-petroleo font-bold text-white", String(i + 1)));
      const texto = el("div", "min-w-0 flex-1");
      texto.appendChild(el("p", "font-bold", item.q.assunto || "Sem assunto"));
      texto.appendChild(el("p", "text-sm text-[#4B5C6B]",
        `${DIFICULDADES[item.q.dificuldade] || ""}, ${TIPOS[item.q.tipo] || ""}${item.q.statusValidacao !== "aprovada" ? ", aguardando validação" : ""}`));
      topo.appendChild(texto);
      linha.appendChild(topo);

      const controles = el("div", "mt-2 flex flex-wrap items-end gap-2");

      const caixaValor = el("div", "w-28");
      const rotuloValor = el("label", "rotulo", "Valor");
      const campoValor = el("input", "campo");
      campoValor.type = "number";
      campoValor.min = "0";
      campoValor.step = "0.25";
      campoValor.value = String(item.valor);
      campoValor.id = `p-valor-${i}`;
      rotuloValor.htmlFor = campoValor.id;
      campoValor.disabled = dividirIgual();
      campoValor.addEventListener("input", () => {
        item.valor = Math.max(0, Number(campoValor.value) || 0);
        atualizarResumo();
      });
      caixaValor.append(rotuloValor, campoValor);
      controles.appendChild(caixaValor);

      const botao = (rotulo, aria, classes, aoClicar, desabilitado = false) => {
        const b = el("button", `rounded-[10px] px-3 py-2 font-bold ${classes}`, rotulo);
        b.type = "button";
        b.setAttribute("aria-label", aria);
        b.disabled = desabilitado;
        if (desabilitado) b.classList.add("opacity-40");
        b.addEventListener("click", aoClicar);
        controles.appendChild(b);
      };
      botao("Subir", `Subir a questão ${i + 1}`, "border-2 border-[#9FB0BE] text-[#33475B]", () => mover(i, -1), i === 0);
      botao("Descer", `Descer a questão ${i + 1}`, "border-2 border-[#9FB0BE] text-[#33475B]", () => mover(i, 1), i === selecionadas.length - 1);
      botao("Remover", `Remover a questão ${i + 1}`, "border-2 border-[#9FB0BE] text-alerta", () => alternar(item.q));

      linha.appendChild(controles);
      lista.appendChild(linha);
    });
    atualizarResumo();
  }

  function aoMudarSelecao() {
    recalcularValores();
    desenharSelecionadas();
    desenharPool();
  }

  // ----- Dados para desenhar a prova -----
  function lerCabecalho() {
    return {
      titulo: $("#p-titulo", area).value.trim(),
      professor: $("#p-professor", area).value.trim(),
      turma: $("#p-turma", area).value.trim(),
      data: $("#p-data", area).value,
      instrucoes: $("#p-instrucoes", area).value.trim(),
      valorTotal: valorTotal()
    };
  }

  function montarDados() {
    const c = lerCabecalho();
    return {
      db: ctx.db,
      escola,
      cabecalho: {
        ...c,
        disciplina: contexto ? contexto.disciplina : "",
        ano: contexto ? contexto.ano : "",
        bimestre: contexto ? contexto.bimestre : ""
      },
      itens: selecionadas,
      config: { linhas: Number($("#p-linhas", area).value) || 0 }
    };
  }

  const acessivel = () => $("#p-acessivel", area).checked;
  const classeFolha = () => "folha" + (acessivel() ? " folha-acessivel" : "");

  function validarParaSaida() {
    mostrarErro("#p-erro5", "");
    if (selecionadas.length === 0) {
      mostrarErro("#p-erro5", "Adicione pelo menos uma questão à prova.");
      return false;
    }
    if (lerCabecalho().titulo.length < 3) {
      mostrarErro("#p-erro5", "Dê um título à prova.");
      $("#p-titulo", area).focus();
      return false;
    }
    return true;
  }

  async function atualizarPrevia() {
    if (!validarParaSaida()) return;
    const ficha = ++tokenPrevia;
    const caixa = $("#p-previa", area);
    caixa.classList.remove("hidden");
    caixa.className = `${classeFolha()} mt-4 overflow-x-auto rounded-lg border border-[#B9C4CE] p-5`;
    caixa.replaceChildren(el("p", "text-sm", "Montando a prévia…"));
    try {
      const destino = el("div");
      await renderizarProva(destino, montarDados());
      if (ficha === tokenPrevia) caixa.replaceChildren(destino);
    } catch (e) {
      console.error(e);
      caixa.replaceChildren(el("p", "font-bold text-alerta", "Não foi possível montar a prévia."));
    }
  }

  async function imprimir(tipo) {
    if (!validarParaSaida()) return;

    const pendentes = selecionadas.filter((item) => item.q.statusValidacao !== "aprovada").length;
    if (tipo === "prova" && pendentes > 0) {
      const resposta = await perguntar({
        titulo: "Questões sem validação",
        texto: `${pendentes} questão(ões) desta prova ainda não foram aprovadas pela coordenação. Imprimir mesmo assim?`,
        rotuloOk: "Imprimir mesmo assim"
      });
      if (!resposta.ok) return;
    }

    const folha = document.getElementById("folha-impressao");
    try {
      const conteudo = el("div", classeFolha());
      const dados = montarDados();
      if (tipo === "gabarito") await renderizarGabarito(conteudo, dados);
      else await renderizarProva(conteudo, dados);
      folha.replaceChildren(conteudo);

      await ctx.registrarAuditoria(tipo === "gabarito" ? "gabarito_impresso" : "prova_impressa", {
        titulo: dados.cabecalho.titulo,
        disciplina: dados.cabecalho.disciplina,
        ano: dados.cabecalho.ano,
        questoes: selecionadas.length,
        semValidacao: pendentes
      });
      window.print();
    } catch (e) {
      console.error(e);
      mostrarErro("#p-erro5", "Não foi possível preparar a impressão.");
    }
  }

  // ----- Salvar e reabrir provas -----
  async function salvarProva() {
    if (!validarParaSaida() || !contexto) return;
    const c = lerCabecalho();
    const campos = {
      titulo: c.titulo,
      segmento: contexto.segmento,
      ano: contexto.ano,
      disciplina: contexto.disciplina,
      bimestre: contexto.bimestre ? Number(contexto.bimestre) : null,
      incluiPendentes: contexto.incluirPendentes,
      questoesIds: selecionadas.map((item) => item.q.id),
      valores: selecionadas.map((item) => Number(item.valor) || 0),
      config: {
        professor: c.professor,
        turma: c.turma,
        data: c.data,
        instrucoes: c.instrucoes,
        valorTotal: c.valorTotal,
        dividirIgual: dividirIgual(),
        linhas: Number($("#p-linhas", area).value) || 0,
        acessivel: acessivel()
      },
      ultimaModificacaoEm: serverTimestamp()
    };

    const botao = $("#p-salvar", area);
    botao.disabled = true;
    try {
      if (provaSalvaId) {
        await updateDoc(doc(ctx.db, "provas", provaSalvaId), campos);
        await ctx.registrarAuditoria("prova_atualizada", { provaId: provaSalvaId, titulo: c.titulo });
        ctx.aviso("Prova atualizada.");
      } else {
        const ref = await addDoc(collection(ctx.db, "provas"), {
          ...campos,
          criadoPorUid: ctx.estado.usuario.uid,
          criadoPor: ctx.estado.perfil.nome,
          criadoEm: serverTimestamp()
        });
        provaSalvaId = ref.id;
        await ctx.registrarAuditoria("prova_salva", { provaId: ref.id, titulo: c.titulo, questoes: selecionadas.length });
        ctx.aviso("Prova salva.");
      }
      await carregarSalvas();
    } catch (e) {
      console.error(e);
      mostrarErro("#p-erro5", "Não foi possível salvar a prova. Confira as regras do Firestore.");
    } finally {
      botao.disabled = false;
    }
  }

  async function abrirProva(p) {
    selSegmento.value = p.segmento;
    sincronizarSegmento();
    selAno.value = p.ano;
    selDisciplina.value = p.disciplina;
    $("#p-bimestre", area).value = p.bimestre ? String(p.bimestre) : "";
    $("#p-pendentes", area).checked = Boolean(p.incluiPendentes);
    contexto = null;

    const ok = await carregarPool(true);
    if (!ok) return;

    const docs = await Promise.all((p.questoesIds || []).map((id) => getDoc(doc(ctx.db, "questoes", id))));
    selecionadas = [];
    let perdidas = 0;
    docs.forEach((d, i) => {
      if (d.exists()) selecionadas.push({ q: { id: d.id, ...d.data() }, valor: Number((p.valores || [])[i]) || 0 });
      else perdidas++;
    });

    const cfg = p.config || {};
    $("#p-titulo", area).value = p.titulo || "";
    $("#p-professor", area).value = cfg.professor || ctx.estado.perfil.nome;
    $("#p-turma", area).value = cfg.turma || "";
    $("#p-data", area).value = cfg.data || "";
    $("#p-instrucoes", area).value = cfg.instrucoes || INSTRUCOES_PADRAO;
    $("#p-valortotal", area).value = String(cfg.valorTotal ?? 10);
    $("#p-dividir", area).checked = cfg.dividirIgual !== false;
    $("#p-linhas", area).value = String(cfg.linhas ?? 5);
    $("#p-acessivel", area).checked = Boolean(cfg.acessivel);

    // Só quem criou a prova atualiza a original; os outros salvam uma cópia.
    provaSalvaId = p.criadoPorUid === ctx.estado.usuario.uid ? p.id : null;

    if (!dividirIgual()) desenharSelecionadas();
    else aoMudarSelecao();
    $("#p-salvas-caixa", area).open = false;
    $("#p-passos", area).scrollIntoView({ behavior: "smooth", block: "start" });
    ctx.aviso(perdidas > 0
      ? `Prova aberta. ${perdidas} questão(ões) não existem mais e foram deixadas de fora.`
      : (provaSalvaId ? "Prova aberta." : "Prova aberta como cópia. Ao salvar, ela será uma prova nova sua."),
    perdidas > 0 ? "erro" : "ok");
  }

  async function excluirProva(p) {
    const resposta = await perguntar({
      titulo: "Excluir prova salva",
      texto: `Excluir a prova “${p.titulo}”? As questões continuam no banco.`,
      rotuloOk: "Excluir prova",
      perigo: true
    });
    if (!resposta.ok) return;
    try {
      await deleteDoc(doc(ctx.db, "provas", p.id));
      await ctx.registrarAuditoria("prova_excluida", { provaId: p.id, titulo: p.titulo });
      if (provaSalvaId === p.id) provaSalvaId = null;
      ctx.aviso("Prova excluída.");
      await carregarSalvas();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível excluir a prova.", "erro");
    }
  }

  async function carregarSalvas() {
    if (!ctx.estado.usuario) return;
    const alvo = $("#p-salvas", area);
    alvo.replaceChildren(el("p", "text-sm text-[#4B5C6B]", "Carregando…"));
    try {
      const snap = await getDocs(query(collection(ctx.db, "provas"), orderBy("criadoEm", "desc"), limit(40)));
      salvas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      alvo.replaceChildren();

      if (salvas.length === 0) {
        alvo.appendChild(el("p", "text-[#4B5C6B]", "Nenhuma prova salva ainda."));
        return;
      }
      const ul = el("ul", "space-y-2");
      const ehSupervisor = ctx.estado.perfil.cargo === "supervisor";
      salvas.forEach((p) => {
        const li = el("li", "rounded-lg border border-[#E3E9EE] p-3");
        li.appendChild(el("p", "font-bold", p.titulo));
        li.appendChild(el("p", "text-sm text-[#4B5C6B]",
          `${p.disciplina}, ${p.ano}. ${(p.questoesIds || []).length} questão(ões). Por ${p.criadoPor || "autor desconhecido"} em ${formatarData(p.criadoEm)}.`));
        const acoes = el("div", "mt-2 flex flex-wrap gap-2");
        const abrir = el("button", "rounded-[10px] bg-petroleo px-4 py-2 font-bold text-white hover:bg-petroleo-escuro", "Abrir");
        abrir.type = "button";
        abrir.addEventListener("click", () => abrirProva(p));
        acoes.appendChild(abrir);
        if (p.criadoPorUid === ctx.estado.usuario.uid || ehSupervisor) {
          const excluir = el("button", "rounded-[10px] border-2 border-[#9FB0BE] px-4 py-2 font-bold text-alerta hover:bg-[#FBE9E4]", "Excluir");
          excluir.type = "button";
          excluir.addEventListener("click", () => excluirProva(p));
          acoes.appendChild(excluir);
        }
        li.appendChild(acoes);
        ul.appendChild(li);
      });
      alvo.appendChild(ul);
    } catch (e) {
      console.error(e);
      alvo.replaceChildren(el("p", "text-sm font-bold text-alerta", "Não foi possível carregar as provas salvas."));
    }
  }

  function limpar() {
    pool = [];
    selecionadas = [];
    salvas = [];
    contexto = null;
    provaSalvaId = null;
    $("#p-passos", area).classList.add("hidden");
    $("#p-salvas", area).replaceChildren();
    $("#p-previa", area).classList.add("hidden");
    document.getElementById("folha-impressao").replaceChildren();
  }

  // ----- Eventos -----
  selSegmento.addEventListener("change", sincronizarSegmento);
  $("#p-buscar", area).addEventListener("click", () => carregarPool(false));

  const aoFiltrar = () => { visiveis = POR_PAGINA; desenharPool(); };
  $("#p-f-assunto", area).addEventListener("change", (ev) => { filtros.assunto = ev.target.value; aoFiltrar(); });
  $("#p-f-dif", area).addEventListener("change", (ev) => { filtros.dificuldade = ev.target.value; aoFiltrar(); });
  $("#p-f-tipo", area).addEventListener("change", (ev) => { filtros.tipo = ev.target.value; aoFiltrar(); });
  $("#p-f-adapt", area).addEventListener("change", (ev) => { filtros.adaptacao = ev.target.value; aoFiltrar(); });
  $("#p-f-busca", area).addEventListener("input", (ev) => { filtros.busca = ev.target.value; aoFiltrar(); });
  $("#p-mais", area).addEventListener("click", () => { visiveis += POR_PAGINA; desenharPool(); });
  $("#p-sortear", area).addEventListener("click", sortear);

  $("#p-dividir", area).addEventListener("change", () => {
    recalcularValores();
    desenharSelecionadas();
  });
  $("#p-valortotal", area).addEventListener("input", () => {
    recalcularValores();
    desenharSelecionadas();
  });
  $("#p-embaralhar", area).addEventListener("click", () => {
    selecionadas = embaralharGrupos(selecionadas);
    desenharSelecionadas();
  });
  $("#p-limpar-sel", area).addEventListener("click", () => {
    selecionadas = [];
    aoMudarSelecao();
  });

  $("#p-previa-btn", area).addEventListener("click", atualizarPrevia);
  $("#p-imprimir", area).addEventListener("click", () => imprimir("prova"));
  $("#p-gabarito", area).addEventListener("click", () => imprimir("gabarito"));
  $("#p-salvar", area).addEventListener("click", salvarProva);

  window.addEventListener("hashchange", () => {
    if (location.hash === "#provas") carregarSalvas();
  });

  sincronizarSegmento();
  return { carregarSalvas, limpar };
}
