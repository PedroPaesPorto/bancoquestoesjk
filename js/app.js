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
import { iniciarImportacao } from "./importacao.js";

// ---------- Utilidades ----------
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

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
  const el = $("#toast");
  el.textContent = texto;
  el.className = "toast " + (tipo === "erro" ? "toast-erro" : "toast-ok") + " toast-visivel";
  clearTimeout(aviso.timer);
  aviso.timer = setTimeout(() => el.classList.remove("toast-visivel"), 3800);
}

function mostrarErroForm(idForm, texto) {
  const el = $(`#${idForm} [data-erro]`);
  el.textContent = texto || "";
  el.classList.toggle("hidden", !texto);
}

function carregando(botao, ativo, textoOriginal) {
  botao.disabled = ativo;
  botao.textContent = ativo ? "Aguarde…" : textoOriginal;
}

const ROTULO_CARGO = { professor: "Professor(a)", supervisor: "Coordenador(a) / Supervisor(a)" };

// ---------- Estado ----------
const estado = { usuario: null, perfil: null, cadastrando: false };
let auth = null;
let db = null;
let banco = null;

// ---------- Auditoria ----------
export async function registrarAuditoria(acao, detalhes = {}) {
  if (!db || !estado.usuario || !estado.perfil) return;
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
function mostrarLogin() {
  $("#tela-login").classList.remove("hidden");
  $("#tela-app").classList.add("hidden");
}

function mostrarApp() {
  $("#tela-login").classList.add("hidden");
  $("#tela-app").classList.remove("hidden");

  const { nome, cargo } = estado.perfil;
  $$("[data-nome-usuario]").forEach((el) => (el.textContent = nome));
  $$("[data-cargo-usuario]").forEach((el) => (el.textContent = ROTULO_CARGO[cargo] || cargo));
  $$("[data-inicial-usuario]").forEach((el) => (el.textContent = nome.trim().charAt(0).toUpperCase()));
  $$("[data-escola]").forEach((el) => (el.textContent = escola.nome));

  const ehSupervisor = cargo === "supervisor";
  $$(".so-supervisor").forEach((el) => el.classList.toggle("hidden", !ehSupervisor));

  navegar();
  carregarResumo();
  if (banco && location.hash === "#banco") banco.carregar();
}

const VIEWS = ["inicio", "banco", "nova", "importar", "provas", "acessibilidade", "auditoria"];

function navegar() {
  let nome = location.hash.replace("#", "");
  if (!VIEWS.includes(nome)) nome = "inicio";
  if (nome === "auditoria" && (!estado.perfil || estado.perfil.cargo !== "supervisor")) nome = "inicio";

  $$("[data-view]").forEach((el) => el.classList.toggle("hidden", el.dataset.view !== nome));
  $$("[data-nav]").forEach((el) => {
    const ativo = el.dataset.nav === nome;
    el.classList.toggle("nav-ativo", ativo);
    if (ativo) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
}

async function carregarResumo() {
  const alvoTotal = $("#res-total");
  const alvoPendentes = $("#res-pendentes");
  const alvoMinhas = $("#res-minhas");
  try {
    const col = collection(db, "questoes");
    const [total, pendentes, minhas] = await Promise.all([
      getCountFromServer(col),
      getCountFromServer(query(col, where("statusValidacao", "==", "pendente"))),
      getCountFromServer(query(col, where("criadoPorUid", "==", estado.usuario.uid)))
    ]);
    alvoTotal.textContent = total.data().count;
    alvoPendentes.textContent = pendentes.data().count;
    alvoMinhas.textContent = minhas.data().count;
  } catch (e) {
    console.warn("Resumo indisponível:", e);
    [alvoTotal, alvoPendentes, alvoMinhas].forEach((el) => (el.textContent = "0"));
  }
}

// ---------- Perfil ----------
async function carregarPerfil(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const perfil = {
    nome: user.displayName || user.email.split("@")[0],
    email: user.email,
    cargo: "professor",
    criadoEm: serverTimestamp()
  };
  await setDoc(ref, perfil);
  return { ...perfil, criadoEm: null };
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
        criadoEm: serverTimestamp()
      });
      estado.usuario = cred.user;
      estado.perfil = { nome, email, cargo: "professor" };
      await registrarAuditoria("conta_criada", { email });
      estado.cadastrando = false;
      mostrarApp();
      aviso("Conta criada. Bem-vindo(a)!");
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
  
  const questoes = iniciarQuestoes({ db, estado, registrarAuditoria, aviso, aoSalvar: carregarResumo });
  banco = iniciarBanco({
    db,
    estado,
    registrarAuditoria,
    aviso,
    aoAlterar: carregarResumo,
    aoEditar: (questao) => {
      questoes.editar(questao);
      location.hash = "#nova";
    }
  });
  
  iniciarImportacao({ db, estado, registrarAuditoria, aviso });

  onAuthStateChanged(auth, async (user) => {
    if (estado.cadastrando) return;
    if (!user) {
      estado.usuario = null;
      estado.perfil = null;
      if (banco) banco.limpar();
      mostrarLogin();
      return;
    }
    try {
      estado.usuario = user;
      estado.perfil = await carregarPerfil(user);
      mostrarApp();
      await registrarAuditoria("login");
    } catch (e) {
      console.error(e);
      aviso("Não foi possível carregar seu perfil. Confira as regras do Firestore.", "erro");
      await signOut(auth);
    }
  });
}

iniciar();
