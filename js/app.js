import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, collection,
  serverTimestamp, getCountFromServer, query, where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, escola, configurado } from "./firebase-config.js";
import { iniciarQuestoes } from "./questoes.js";
import { iniciarBanco } from "./banco.js";
import { iniciarEquipe } from "./equipe.js";
import { iniciarProvas } from "./provas.js";
import { $, $$, rotuloCargo } from "./util.js";

// ---------- Utilidades ----------
const ERROS_AUTH = {
  "auth/invalid-email": "O e-mail informado não é válido.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Não existe conta com este e-mail.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/email-already-in-use": "Este e-mail já tem conta. Use a aba Entrar.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem conexão com a internet. Verifique e tente de novo.",
  "auth/operation-not-allowed": "Login por e-mail e senha não está ativado no Firebase."
};

function mensagemDeErro(erro) {
  return ERROS_AUTH[erro && erro.code] || "Algo deu errado. Tente novamente.";
}

function aviso(texto, tipo = "ok") {
  const caixa = $("#toast");
  caixa.textContent = texto;
  caixa.className = "toast " + (tipo === "erro" ? "toast-erro" : "toast-ok") + " toast-visivel";
  clearTimeout(aviso.timer);
  aviso.timer = setTimeout(() => caixa.classList.remove("toast-visivel"), 3800);
}

function mostrarErroForm(idForm, texto) {
  const caixa = $(`#${idForm} [data-erro]`);
  caixa.textContent = texto || "";
  caixa.classList.toggle("hidden", !texto);
}

function carregando(botao, ativo, textoOriginal) {
  botao.disabled = ativo;
  botao.textContent = ativo ? "Aguarde…" : textoOriginal;
}

// ---------- Estado ----------
const estado = { usuario: null, perfil: null, cadastrando: false };
let auth = null;
let db = null;
let banco = null;
let equipe = null;
let provas = null;

// ---------- Auditoria ----------
// Só contas ativas conseguem gravar (as regras do Firestore exigem).
export async function registrarAuditoria(acao, detalhes = {}) {
  if (!db || !estado.usuario || !estado.perfil || estado.perfil.ativo !== true) return;
  try {
    await addDoc(collection(db, "auditoria"), {
      acao,
      detalhes,
      usuarioUid: estado.usuario.uid,
      usuarioNome: estado.perfil.nome,
      cargo: estado.perfil.cargo,
      em: serverTimestamp()
    });
  } catch (e) {
    console.warn("Não foi possível registrar a auditoria:", e);
  }
}

// ---------- Telas ----------
function esconderTelas() {
  ["#tela-login", "#tela-pendente", "#tela-app"].forEach((id) => $(id).classList.add("hidden"));
}

function mostrarLogin() {
  esconderTelas();
  $("#tela-login").classList.remove("hidden");
}

function mostrarPendente() {
  esconderTelas();
  $("#tela-pendente").classList.remove("hidden");
  const desativada = Boolean(estado.perfil && estado.perfil.desativadoEm);
  $("#pendente-titulo").textContent = desativada ? "Sua conta está desativada" : "Sua conta aguarda liberação";
  $("#pendente-texto").textContent = desativada
    ? "Procure a coordenação da escola para reativar o seu acesso."
    : "Para proteger as provas da escola, a coordenação precisa liberar cada conta nova. Avise o Supervisor de que você se cadastrou e toque em “Verificar de novo”.";
  $("#pendente-quem").textContent = estado.perfil ? `${estado.perfil.nome} (${estado.perfil.email})` : "";
}

const VIEWS = ["inicio", "banco", "nova", "provas", "acessibilidade", "equipe", "auditoria"];
const SO_SUPERVISOR = ["equipe", "auditoria"];

function navegar() {
  let nome = location.hash.replace("#", "");
  if (!VIEWS.includes(nome)) nome = "inicio";
  const ehSupervisor = estado.perfil && estado.perfil.cargo === "supervisor";
  if (SO_SUPERVISOR.includes(nome) && !ehSupervisor) nome = "inicio";

  $$("[data-view]").forEach((secao) => secao.classList.toggle("hidden", secao.dataset.view !== nome));
  $$("[data-nav]").forEach((link) => {
    const ativo = link.dataset.nav === nome;
    link.classList.toggle("nav-ativo", ativo);
    if (ativo) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
}

function mostrarApp() {
  esconderTelas();
  $("#tela-app").classList.remove("hidden");

  const { nome, cargo } = estado.perfil;
  $$("[data-nome-usuario]").forEach((e) => (e.textContent = nome));
  $$("[data-cargo-usuario]").forEach((e) => (e.textContent = rotuloCargo(cargo)));
  $$("[data-inicial-usuario]").forEach((e) => (e.textContent = nome.trim().charAt(0).toUpperCase()));
  $$("[data-escola]").forEach((e) => (e.textContent = escola.nome));

  const ehSupervisor = cargo === "supervisor";
  $$(".so-supervisor").forEach((e) => e.classList.toggle("hidden", !ehSupervisor));

  navegar();
  carregarResumo();
  if (banco && location.hash === "#banco") banco.carregar();
  if (equipe && location.hash === "#equipe") equipe.carregar();
  if (provas && location.hash === "#provas") provas.carregarSalvas();
}

async function carregarResumo() {
  const alvoTotal = $("#res-total");
  const alvoPendentes = $("#res-pendentes");
  const alvoMinhas = $("#res-minhas");
  try {
    const col = collection(db, "questoes");
    const uid = estado.usuario.uid;
    const [total, pendentes, minhas] = await Promise.all([
      getCountFromServer(col),
      getCountFromServer(query(col, where("statusValidacao", "==", "pendente"))),
      getCountFromServer(query(col, where("responsavelUid", "==", uid)))
    ]);
    alvoTotal.textContent = total.data().count;
    alvoPendentes.textContent = pendentes.data().count;
    alvoMinhas.textContent = minhas.data().count;
  } catch (e) {
    console.warn("Resumo indisponível:", e);
    [alvoTotal, alvoPendentes, alvoMinhas].forEach((e2) => (e2.textContent = "0"));
  }

  // Aviso de contas novas para o Supervisor
  const aviso_contas = $("#aviso-contas");
  aviso_contas.classList.add("hidden");
  if (estado.perfil && estado.perfil.cargo === "supervisor") {
    try {
      const novas = await getCountFromServer(query(collection(db, "users"), where("ativo", "==", false)));
      const quantidade = novas.data().count;
      if (quantidade > 0) {
        $("#aviso-contas-texto").textContent = quantidade === 1
          ? "1 conta aguarda liberação."
          : `${quantidade} contas aguardam liberação.`;
        aviso_contas.classList.remove("hidden");
      }
    } catch (e) {
      console.warn("Contagem de contas indisponível:", e);
    }
  }
}

// ---------- Perfil ----------
async function carregarPerfil(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  // Conta sem perfil (ex.: criada pelo Console): entra como Professor, aguardando liberação.
  const perfil = {
    nome: user.displayName || user.email.split("@")[0],
    email: user.email,
    cargo: "professor",
    ativo: false,
    criadoEm: serverTimestamp()
  };
  await setDoc(ref, perfil);
  return { ...perfil, criadoEm: null };
}

async function entrar(user) {
  estado.usuario = user;
  estado.perfil = await carregarPerfil(user);

  if (estado.perfil.ativo !== true) {
    mostrarPendente();
    return;
  }
  mostrarApp();
  await registrarAuditoria("login");
}

// ---------- Formulários ----------
function configurarAbas() {
  $$("[data-aba]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const alvo = botao.dataset.aba;
      $$("[data-aba]").forEach((b) => {
        const ativo = b === botao;
        b.classList.toggle("aba-ativa", ativo);
        b.setAttribute("aria-selected", ativo ? "true" : "false");
      });
      $("#form-entrar").classList.toggle("hidden", alvo !== "entrar");
      $("#form-cadastrar").classList.toggle("hidden", alvo !== "cadastrar");
    });
  });
}

function configurarFormularios() {
  $("#form-entrar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    mostrarErroForm("form-entrar", "");
    const botao = $("#form-entrar button[type=submit]");
    carregando(botao, true, "Entrar");
    try {
      await signInWithEmailAndPassword(auth, $("#entrar-email").value.trim(), $("#entrar-senha").value);
    } catch (e) {
      mostrarErroForm("form-entrar", mensagemDeErro(e));
    } finally {
      carregando(botao, false, "Entrar");
    }
  });

  $("#form-cadastrar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    mostrarErroForm("form-cadastrar", "");
    const nome = $("#cad-nome").value.trim();
    const email = $("#cad-email").value.trim();
    const senha = $("#cad-senha").value;
    if (nome.length < 3) {
      mostrarErroForm("form-cadastrar", "Digite seu nome completo.");
      return;
    }
    const botao = $("#form-cadastrar button[type=submit]");
    carregando(botao, true, "Criar conta");
    estado.cadastrando = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      await updateProfile(cred.user, { displayName: nome });
      await setDoc(doc(db, "users", cred.user.uid), {
        nome,
        email,
        cargo: "professor",
        ativo: false,
        criadoEm: serverTimestamp()
      });
      estado.usuario = cred.user;
      estado.perfil = { nome, email, cargo: "professor", ativo: false };
      estado.cadastrando = false;
      mostrarPendente();
    } catch (e) {
      estado.cadastrando = false;
      mostrarErroForm("form-cadastrar", mensagemDeErro(e));
    } finally {
      carregando(botao, false, "Criar conta");
    }
  });

  $("#link-esqueci").addEventListener("click", async () => {
    const email = $("#entrar-email").value.trim();
    if (!email) {
      mostrarErroForm("form-entrar", "Digite seu e-mail acima e toque em \"Esqueci minha senha\" de novo.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      mostrarErroForm("form-entrar", "");
      aviso("Enviamos o link de redefinição para o seu e-mail.");
    } catch (e) {
      mostrarErroForm("form-entrar", mensagemDeErro(e));
    }
  });

  $("#btn-verificar").addEventListener("click", async () => {
    const botao = $("#btn-verificar");
    carregando(botao, true, "Verificar de novo");
    try {
      await entrar(auth.currentUser);
      if (estado.perfil.ativo !== true) aviso("Sua conta ainda não foi liberada.", "erro");
    } catch (e) {
      console.error(e);
      aviso("Não foi possível verificar agora. Tente de novo.", "erro");
    } finally {
      carregando(botao, false, "Verificar de novo");
    }
  });

  $$("[data-sair]").forEach((el) =>
    el.addEventListener("click", async () => {
      await registrarAuditoria("logout");
      await signOut(auth);
    })
  );
}

// ---------- Inicialização ----------
function iniciar() {
  configurarAbas();
  window.addEventListener("hashchange", navegar);

  if (!configurado) {
    $("#aviso-config").classList.remove("hidden");
    $$("#tela-login form button").forEach((b) => (b.disabled = true));
    return;
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  configurarFormularios();

  const base = { db, estado, registrarAuditoria, aviso, aoAlterar: carregarResumo };

  const questoes = iniciarQuestoes({ ...base, aoSalvar: carregarResumo });
  banco = iniciarBanco({
    ...base,
    aoEditar: async (questao) => {
      await questoes.editar(questao);
      location.hash = "#nova";
    },
    aoVersao: async (questao) => {
      await questoes.versao(questao);
      location.hash = "#nova";
    }
  });
  equipe = iniciarEquipe(base);
  provas = iniciarProvas(base);

  onAuthStateChanged(auth, async (user) => {
    if (estado.cadastrando) return; // o fluxo de cadastro conclui sozinho
    if (!user) {
      estado.usuario = null;
      estado.perfil = null;
      if (banco) banco.limpar();
      if (equipe) equipe.limpar();
      if (provas) provas.limpar();
      mostrarLogin();
      return;
    }
    try {
      await entrar(user);
    } catch (e) {
      console.error(e);
      aviso("Não foi possível carregar seu perfil. Confira as regras do Firestore.", "erro");
      await signOut(auth);
    }
  });
}

iniciar();
