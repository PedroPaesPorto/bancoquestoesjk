import {
  addDoc, collection, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { SEGMENTOS, BIMESTRES, TIPOS, DIFICULDADES, LETRAS } from "./curriculo.js";

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

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
        <div class="flex-1">
          <label class="rotulo" for="alt-${letra}">Alternativa ${letra}${opcional}</label>
          <input id="alt-${letra}" type="text" class="campo" autocomplete="off">
        </div>
      </div>`;
  }).join("");

  return `
    <h1 id="q-titulo" class="text-2xl font-bold sm:text-3xl">Nova questão</h1>
    <p class="mt-1 text-[#33475B]">Toda questão nova fica aguardando validação até o Supervisor aprovar.</p>

    <div id="q-banner" class="mt-4 hidden flex-col gap-2 rounded-xl border-2 border-marca bg-[#FFF6DB] p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <p class="font-bold">Você está editando uma questão. Ao salvar, ela volta para validação.</p>
      <button type="button" id="q-cancelar-edicao"
              class="rounded-[10px] border-2 border-[#9FB0BE] bg-white px-4 py-2 font-bold text-[#33475B]">
        Cancelar edição
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
        <legend class="px-1 text-lg font-bold">Enunciado</legend>
        <div class="mt-2">
          <label class="rotulo" for="q-enunciado">Texto da questão</label>
          <textarea id="q-enunciado" rows="5" maxlength="4000" class="campo"></textarea>
        </div>
      </fieldset>

      <fieldset id="bloco-mc" class="rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
        <legend class="px-1 text-lg font-bold">Alternativas e gabarito</legend>
        <p class="mt-1 text-sm text-[#4B5C6B]">Preencha de A a D. Marque o círculo ao lado da alternativa correta.</p>
        <div class="mt-4 space-y-4">${alternativas}</div>
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
  if (!area) return { editar() {} };
  area.innerHTML = htmlFormulario();

  const form = $("#form-questao", area);
  const selSegmento = $("#q-segmento", area);
  const selAno = $("#q-ano", area);
  const selDisciplina = $("#q-disciplina", area);
  const selTipo = $("#q-tipo", area);
  const erro = $("#q-erro", area);
  const botaoSalvar = $("#q-salvar", area);
  const contador = $("#q-contador", area);
  let salvasNaSessao = 0;
  let editando = null; // { id } quando estamos editando uma questão existente

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

  function atualizarModo() {
    const emEdicao = Boolean(editando);
    $("#q-titulo", area).textContent = emEdicao ? "Editar questão" : "Nova questão";
    const banner = $("#q-banner", area);
    banner.classList.toggle("hidden", !emEdicao);
    banner.classList.toggle("flex", emEdicao);
    botaoSalvar.textContent = emEdicao ? "Salvar alterações" : "Salvar questão";
  }

  function sairDaEdicao() {
    editando = null;
    atualizarModo();
  }

  function atualizarContador() {
    contador.textContent = salvasNaSessao > 0
      ? `Questões cadastradas nesta sessão: ${salvasNaSessao}. O segmento, o ano, a disciplina, o bimestre e o assunto ficam preenchidos para a próxima.`
      : "";
  }

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

  // Devolve { erro, campo } se algo estiver errado, ou { dados } se estiver tudo certo.
  function validar() {
    const d = lerFormulario();

    if (!d.segmento) return { erro: "Escolha o segmento.", campo: selSegmento };
    if (!d.ano) return { erro: "Escolha o ano ou série.", campo: selAno };
    if (!d.disciplina) return { erro: "Escolha a disciplina.", campo: selDisciplina };
    if (!d.bimestre) return { erro: "Escolha o bimestre.", campo: $("#q-bimestre", area) };
    if (d.assunto.length < 3) return { erro: "Informe o assunto ou eixo temático.", campo: $("#q-assunto", area) };
    if (!d.dificuldade) return { erro: "Escolha a dificuldade.", campo: $("#q-dificuldade", area) };
    if (d.enunciado.length < 10) return { erro: "Escreva o enunciado da questão.", campo: $("#q-enunciado", area) };
    if (d.justificativa.length < 5) return { erro: "Escreva a justificativa da resposta.", campo: $("#q-justificativa", area) };

    if (d.tipo === "multipla_escolha") {
      const alternativas = LETRAS
        .map((letra) => ({ letra, texto: $(`#alt-${letra}`, area).value.trim() }))
        .filter((alt) => alt.texto);

      for (const letra of ["A", "B", "C", "D"]) {
        if (!alternativas.some((alt) => alt.letra === letra)) {
          return { erro: `Preencha a alternativa ${letra}.`, campo: $(`#alt-${letra}`, area) };
        }
      }

      const marcada = $('input[name="gabarito-mc"]:checked', area);
      if (!marcada) return { erro: "Marque qual alternativa é a correta.", campo: $("#gab-A", area) };
      if (!alternativas.some((alt) => alt.letra === marcada.value)) {
        return { erro: `A alternativa ${marcada.value} está vazia. Preencha o texto ou marque outra como correta.`, campo: $(`#alt-${marcada.value}`, area) };
      }

      return { dados: { ...d, alternativas, gabarito: marcada.value } };
    }

    const esperada = $("#q-gabarito-disc", area).value.trim();
    if (esperada.length < 5) return { erro: "Descreva a resposta esperada.", campo: $("#q-gabarito-disc", area) };
    return { dados: { ...d, alternativas: [], gabarito: esperada } };
  }

  function limparParaProxima() {
    ["#q-habilidade", "#q-enunciado", "#q-justificativa", "#q-gabarito-disc"].forEach((id) => {
      $(id, area).value = "";
    });
    LETRAS.forEach((letra) => {
      $(`#alt-${letra}`, area).value = "";
      $(`#gab-${letra}`, area).checked = false;
    });
    $("#q-enunciado", area).focus();
  }

  function limparTudo() {
    form.reset();
    sincronizarSegmento();
    sincronizarTipo();
    mostrarErro("");
  }

  // Preenche o formulário com uma questão existente (usado pelo Banco de questões).
  function editar(questao) {
    limparTudo();
    editando = { id: questao.id };

    selSegmento.value = questao.segmento;
    sincronizarSegmento();
    selAno.value = questao.ano;
    selDisciplina.value = questao.disciplina;
    $("#q-bimestre", area).value = String(questao.bimestre);
    $("#q-assunto", area).value = questao.assunto || "";
    $("#q-habilidade", area).value = questao.habilidade || "";
    selTipo.value = questao.tipo;
    $("#q-dificuldade", area).value = questao.dificuldade;
    $("#q-enunciado", area).value = questao.enunciado || "";
    $("#q-justificativa", area).value = questao.justificativa || "";
    sincronizarTipo();

    if (questao.tipo === "multipla_escolha") {
      (questao.alternativas || []).forEach((alt) => {
        const campo = $(`#alt-${alt.letra}`, area);
        if (campo) campo.value = alt.texto;
      });
      const radio = $(`#gab-${questao.gabarito}`, area);
      if (radio) radio.checked = true;
    } else {
      $("#q-gabarito-disc", area).value = questao.gabarito || "";
    }

    atualizarModo();
  }

  selSegmento.addEventListener("change", sincronizarSegmento);
  selTipo.addEventListener("change", sincronizarTipo);

  $("#q-limpar", area).addEventListener("click", () => {
    limparTudo();
    sairDaEdicao();
  });

  $("#q-cancelar-edicao", area).addEventListener("click", () => {
    limparTudo();
    sairDaEdicao();
    location.hash = "#banco";
  });

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
      alternativas: d.alternativas,
      gabarito: d.gabarito,
      justificativa: d.justificativa
    };

    botaoSalvar.disabled = true;
    botaoSalvar.textContent = "Salvando…";

    try {
      if (editando) {
        // Qualquer edição volta a questão para validação.
        await updateDoc(doc(ctx.db, "questoes", editando.id), {
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
          questaoId: editando.id,
          disciplina: d.disciplina,
          ano: d.ano,
          assunto: d.assunto
        });

        sairDaEdicao();
        limparTudo();
        ctx.aviso("Alterações salvas. A questão voltou para validação.");
        if (typeof ctx.aoSalvar === "function") ctx.aoSalvar();
        location.hash = "#banco";
        return;
      }

      const ref = await addDoc(collection(ctx.db, "questoes"), {
        ...campos,
        // Metadados de auditoria
        criadoPorUid: estado.usuario.uid,
        criadoPor: estado.perfil.nome,
        cargo: estado.perfil.cargo,
        criadoEm: serverTimestamp(),
        ultimaModificacaoPor: estado.perfil.nome,
        ultimaModificacaoEm: serverTimestamp(),
        statusValidacao: "pendente"
      });

      await ctx.registrarAuditoria("questao_criada", {
        questaoId: ref.id,
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
      limparParaProxima();
    } catch (e) {
      console.error(e);
      const semPermissao = e && e.code === "permission-denied";
      mostrarErro(semPermissao
        ? "O Firestore recusou o salvamento. Confira se publicou as regras do arquivo firestore.rules."
        : "Não foi possível salvar. Verifique sua conexão e tente de novo.");
    } finally {
      botaoSalvar.disabled = false;
      atualizarModo();
    }
  });

  sincronizarSegmento();
  sincronizarTipo();
  atualizarModo();

  return { editar };
}
