import {
  collection, getDocs, query, where, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { $, el, rotuloCargo } from "./util.js";
import { perguntar } from "./dialogo.js";

const COLECOES_BACKUP = ["questoes", "textosApoio", "imagens", "auditoria"];

export function iniciarEquipe(ctx) {
  const area = document.getElementById("area-equipe");
  if (!area) return { carregar() {}, limpar() {} };

  let usuarios = [];

  area.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Equipe</h1>
        <p class="mt-1 text-[#33475B]">Libere contas novas, defina cargos e passe as questões de quem saiu para outro professor.</p>
      </div>
      <button type="button" id="e-atualizar"
              class="rounded-[10px] border-2 border-petroleo px-4 py-2 font-bold text-petroleo hover:bg-petroleo-claro">
        Atualizar
      </button>
    </div>

    <div id="e-estado" class="mt-5"></div>

    <section class="mt-6" aria-labelledby="e-t-pendentes">
      <h2 id="e-t-pendentes" class="text-lg font-bold">Contas aguardando liberação</h2>
      <ul id="e-pendentes" class="mt-3 space-y-3"></ul>
    </section>

    <section class="mt-8" aria-labelledby="e-t-ativos">
      <h2 id="e-t-ativos" class="text-lg font-bold">Equipe ativa</h2>
      <ul id="e-ativos" class="mt-3 space-y-3"></ul>
    </section>

    <section class="mt-8" aria-labelledby="e-t-inativos">
      <h2 id="e-t-inativos" class="text-lg font-bold">Contas desativadas</h2>
      <ul id="e-inativos" class="mt-3 space-y-3"></ul>
    </section>

    <section class="mt-8 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5" aria-labelledby="e-t-backup">
      <h2 id="e-t-backup" class="text-lg font-bold">Backup do banco</h2>
      <p class="mt-1 text-[#33475B]">Baixa um arquivo com todas as questões, textos de apoio, imagens e a trilha de auditoria. Guarde uma cópia fora do Firebase de tempos em tempos (por exemplo, uma vez por mês).</p>
      <button type="button" id="e-backup" class="btn mt-4 sm:!w-auto">Baixar backup</button>
    </section>
  `;

  function mostrarMensagem(texto, tipo = "info") {
    const caixa = $("#e-estado", area);
    caixa.replaceChildren();
    if (!texto) return;
    const classes = tipo === "erro"
      ? "rounded-xl bg-[#FBE9E4] p-4 font-bold text-alerta"
      : "rounded-xl bg-white border border-[#D5DDE4] p-4 font-bold text-[#33475B]";
    const p = el("p", classes, texto);
    p.setAttribute("role", tipo === "erro" ? "alert" : "status");
    caixa.appendChild(p);
  }

  // ----- Cartão de pessoa -----
  function criarCartao(u) {
    const ehEu = u.id === ctx.estado.usuario.uid;
    const item = el("li", "rounded-xl border border-[#D5DDE4] bg-white p-4");

    const topo = el("div", "flex flex-wrap items-center gap-2");
    topo.appendChild(el("p", "font-bold", u.nome || "Sem nome"));
    if (ehEu) topo.appendChild(el("span", "rounded-full border border-petroleo bg-petroleo-claro px-3 py-0.5 text-sm font-bold text-petroleo-escuro", "Você"));
    topo.appendChild(el("span", "rounded-full border border-[#B9C4CE] px-3 py-0.5 text-sm font-bold text-[#33475B]", rotuloCargo(u.cargo)));
    item.appendChild(topo);
    item.appendChild(el("p", "text-sm text-[#4B5C6B]", u.email || ""));

    const acoes = el("div", "mt-3 flex flex-wrap gap-2");
    const botao = (texto, classes, aoClicar) => {
      const b = el("button", `rounded-[10px] px-4 py-2 font-bold ${classes}`, texto);
      b.type = "button";
      b.addEventListener("click", aoClicar);
      acoes.appendChild(b);
    };

    if (!u.ativo) {
      botao(u.desativadoEm ? "Reativar conta" : "Liberar conta", "bg-petroleo text-white hover:bg-petroleo-escuro", () => ativar(u));
    } else if (!ehEu) {
      botao("Desativar conta", "border-2 border-alerta text-alerta hover:bg-[#FBE9E4]", () => desativar(u));
      botao(u.cargo === "supervisor" ? "Tornar Professor" : "Tornar Supervisor", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => mudarCargo(u));
    }
    if (!ehEu) {
      botao("Transferir questões", "border-2 border-[#9FB0BE] text-[#33475B] hover:bg-giz", () => transferir(u));
    }
    if (acoes.children.length > 0) item.appendChild(acoes);
    return item;
  }

  function preencherLista(seletor, itens, textoVazio) {
    const ul = $(seletor, area);
    ul.replaceChildren();
    if (itens.length === 0) {
      ul.appendChild(el("li", "text-[#4B5C6B]", textoVazio));
      return;
    }
    itens.forEach((u) => ul.appendChild(criarCartao(u)));
  }

  function desenhar() {
    const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR");
    preencherLista("#e-pendentes", usuarios.filter((u) => !u.ativo && !u.desativadoEm).sort(porNome), "Nenhuma conta aguardando.");
    preencherLista("#e-ativos", usuarios.filter((u) => u.ativo).sort(porNome), "Nenhuma conta ativa.");
    preencherLista("#e-inativos", usuarios.filter((u) => !u.ativo && u.desativadoEm).sort(porNome), "Nenhuma conta desativada.");
  }

  // ----- Carregamento -----
  async function carregar() {
    if (!ctx.estado.usuario || ctx.estado.perfil.cargo !== "supervisor") return;
    mostrarMensagem("Carregando equipe…");
    try {
      const snap = await getDocs(collection(ctx.db, "users"));
      usuarios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mostrarMensagem("");
      desenhar();
    } catch (e) {
      console.error(e);
      mostrarMensagem("Não foi possível carregar a equipe. Confira as regras do Firestore e sua conexão.", "erro");
    }
  }

  function limpar() {
    usuarios = [];
    $("#e-pendentes", area).replaceChildren();
    $("#e-ativos", area).replaceChildren();
    $("#e-inativos", area).replaceChildren();
  }

  async function depoisDeAlterar() {
    ctx.aoAlterar();
    await carregar();
  }

  // ----- Ações sobre contas -----
  async function ativar(u) {
    const { perfil, usuario } = ctx.estado;
    try {
      await updateDoc(doc(ctx.db, "users", u.id), {
        ativo: true,
        ativadoPor: perfil.nome,
        ativadoPorUid: usuario.uid,
        ativadoEm: serverTimestamp(),
        desativadoEm: null
      });
      await ctx.registrarAuditoria("conta_ativada", { usuarioAfetado: u.nome, email: u.email });
      ctx.aviso(`Conta de ${u.nome} liberada.`);
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível liberar a conta.", "erro");
    }
  }

  async function desativar(u) {
    const resposta = await perguntar({
      titulo: "Desativar conta",
      texto: `${u.nome} deixa de entrar no sistema. As questões dela continuam no banco, e você pode transferir a responsabilidade por elas depois.`,
      rotuloOk: "Desativar conta",
      perigo: true
    });
    if (!resposta.ok) return;

    try {
      await updateDoc(doc(ctx.db, "users", u.id), {
        ativo: false,
        desativadoEm: serverTimestamp()
      });
      await ctx.registrarAuditoria("conta_desativada", { usuarioAfetado: u.nome, email: u.email });
      ctx.aviso(`Conta de ${u.nome} desativada.`);
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível desativar a conta.", "erro");
    }
  }

  async function mudarCargo(u) {
    const novo = u.cargo === "supervisor" ? "professor" : "supervisor";
    const supervisoresAtivos = usuarios.filter((x) => x.ativo && x.cargo === "supervisor").length;
    if (novo === "professor" && supervisoresAtivos <= 1) {
      ctx.aviso("O sistema precisa ter pelo menos um Supervisor ativo.", "erro");
      return;
    }
    const resposta = await perguntar({
      titulo: novo === "supervisor" ? "Tornar Supervisor" : "Tornar Professor",
      texto: novo === "supervisor"
        ? `${u.nome} poderá aprovar questões, liberar contas, arquivar e ver a auditoria.`
        : `${u.nome} perde o acesso de coordenação e passa a ter só o acesso de professor.`,
      rotuloOk: "Confirmar"
    });
    if (!resposta.ok) return;

    try {
      await updateDoc(doc(ctx.db, "users", u.id), { cargo: novo });
      await ctx.registrarAuditoria("cargo_alterado", { usuarioAfetado: u.nome, de: u.cargo, para: novo });
      ctx.aviso("Cargo alterado.");
      await depoisDeAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível alterar o cargo.", "erro");
    }
  }

  // ----- Transferir responsabilidade pelas questões -----
  async function transferir(origem) {
    const destinos = usuarios.filter((x) => x.ativo && x.id !== origem.id);
    if (destinos.length === 0) {
      ctx.aviso("Não há outra pessoa ativa para receber as questões.", "erro");
      return;
    }

    const resposta = await perguntar({
      titulo: `Transferir questões de ${origem.nome}`,
      texto: "A autoria continua registrada em nome de quem criou. Só muda quem é o responsável por manter cada questão.",
      rotuloOk: "Transferir",
      escolha: {
        rotulo: "Novo responsável",
        opcoes: destinos.map((x) => ({ valor: x.id, rotulo: `${x.nome} (${rotuloCargo(x.cargo)})` }))
      }
    });
    if (!resposta.ok) return;

    const destino = destinos.find((x) => x.id === resposta.valor);
    if (!destino) return;

    try {
      ctx.aviso("Procurando as questões…");
      const [porAutor, porResponsavel] = await Promise.all([
        getDocs(query(collection(ctx.db, "questoes"), where("criadoPorUid", "==", origem.id))),
        getDocs(query(collection(ctx.db, "questoes"), where("responsavelUid", "==", origem.id)))
      ]);

      const mapa = new Map();
      [...porAutor.docs, ...porResponsavel.docs].forEach((d) => mapa.set(d.id, d.data()));
      const ids = [...mapa.entries()]
        .filter(([, q]) => (q.responsavelUid || q.criadoPorUid) === origem.id)
        .map(([id]) => id);

      if (ids.length === 0) {
        ctx.aviso(`${origem.nome} não é responsável por nenhuma questão.`);
        return;
      }

      const { perfil } = ctx.estado;
      for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(ids.slice(i, i + 10).map((id) =>
          updateDoc(doc(ctx.db, "questoes", id), {
            responsavelUid: destino.id,
            responsavel: destino.nome,
            ultimaModificacaoPor: perfil.nome,
            ultimaModificacaoEm: serverTimestamp()
          })
        ));
      }

      await ctx.registrarAuditoria("responsabilidade_transferida", {
        de: origem.nome,
        para: destino.nome,
        quantidade: ids.length
      });
      ctx.aviso(`${ids.length} questão(ões) agora sob responsabilidade de ${destino.nome}.`);
      ctx.aoAlterar();
    } catch (e) {
      console.error(e);
      ctx.aviso("A transferência não terminou. Tente de novo: o que já foi transferido não se repete.", "erro");
    }
  }

  // ----- Backup -----
  async function baixarBackup() {
    const botao = $("#e-backup", area);
    botao.disabled = true;
    botao.textContent = "Preparando backup…";
    try {
      const dados = { geradoEm: new Date().toISOString(), versaoDoModelo: 2 };
      for (const nome of COLECOES_BACKUP) {
        const snap = await getDocs(collection(ctx.db, nome));
        dados[nome] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      const texto = JSON.stringify(dados, (chave, valor) =>
        valor && typeof valor.toDate === "function" ? valor.toDate().toISOString() : valor
      );
      const arquivo = new Blob([texto], { type: "application/json" });
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      const hoje = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `backup-banco-de-questoes-${hoje}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      await ctx.registrarAuditoria("backup_exportado", {
        questoes: dados.questoes.length,
        imagens: dados.imagens.length
      });
      ctx.aviso("Backup baixado.");
    } catch (e) {
      console.error(e);
      ctx.aviso("Não foi possível gerar o backup.", "erro");
    } finally {
      botao.disabled = false;
      botao.textContent = "Baixar backup";
    }
  }

  $("#e-atualizar", area).addEventListener("click", carregar);
  $("#e-backup", area).addEventListener("click", baixarBackup);

  window.addEventListener("hashchange", () => {
    if (location.hash === "#equipe") carregar();
  });

  return { carregar, limpar };
}
