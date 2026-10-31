import {
  addDoc, collection, doc, getDoc, getDocs, query, where, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { el } from "./util.js";

// Imagens ficam no Firestore (coleção "imagens") como texto base64, já reduzidas.
// Motivo: o Firebase Storage exige plano pago. Limite de cada imagem: ~280 KB.
const MAX_CARACTERES = 380000;
const MAX_LADO = 1200;

const cacheImagens = new Map();
const cacheApoios = new Map();

// ---------- Redução de imagem no navegador ----------
function abrirImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não consegui abrir esta imagem. Tente JPG, PNG ou WebP."));
    };
    img.src = url;
  });
}

export async function reduzirImagem(arquivo) {
  if (!arquivo.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem (JPG, PNG ou WebP).");
  }
  if (arquivo.size > 20 * 1024 * 1024) {
    throw new Error("A imagem é grande demais (máximo 20 MB).");
  }

  const img = await abrirImagem(arquivo);
  let escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
  let qualidade = 0.85;

  for (let tentativa = 0; tentativa < 14; tentativa++) {
    const largura = Math.max(1, Math.round(img.naturalWidth * escala));
    const altura = Math.max(1, Math.round(img.naturalHeight * escala));
    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const contexto = tela.getContext("2d");
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, largura, altura);
    contexto.drawImage(img, 0, 0, largura, altura);

    let dataUrl = tela.toDataURL("image/webp", qualidade);
    if (!dataUrl.startsWith("data:image/webp")) dataUrl = tela.toDataURL("image/jpeg", qualidade);

    if (dataUrl.length <= MAX_CARACTERES) return { dataUrl, largura, altura };

    if (qualidade > 0.5) qualidade -= 0.1;
    else escala *= 0.8;
  }
  throw new Error("Não consegui reduzir a imagem o bastante. Recorte só a parte necessária e tente de novo.");
}

// ---------- Leitura e gravação ----------
export async function salvarImagem(db, uid, item) {
  const dados = {
    dataUrl: item.dataUrl,
    alt: item.alt.trim(),
    largura: item.largura || 0,
    altura: item.altura || 0,
    criadoPorUid: uid,
    criadoEm: serverTimestamp()
  };
  const ref = await addDoc(collection(db, "imagens"), dados);
  cacheImagens.set(ref.id, { id: ref.id, ...dados });
  return ref.id;
}

// Salva só as imagens novas e devolve a lista de ids na ordem original.
export async function persistirImagens(db, uid, itens) {
  const ids = [];
  for (const item of itens) {
    if (!item.id) item.id = await salvarImagem(db, uid, item);
    ids.push(item.id);
  }
  return ids;
}

export async function obterImagem(db, id) {
  if (!id) return null;
  if (cacheImagens.has(id)) return cacheImagens.get(id);
  const snap = await getDoc(doc(db, "imagens", id));
  if (!snap.exists()) return null;
  const dados = { id: snap.id, ...snap.data() };
  cacheImagens.set(id, dados);
  return dados;
}

export async function obterApoio(db, id) {
  if (!id) return null;
  if (cacheApoios.has(id)) return cacheApoios.get(id);
  const snap = await getDoc(doc(db, "textosApoio", id));
  if (!snap.exists()) return null;
  const dados = { id: snap.id, ...snap.data() };
  cacheApoios.set(id, dados);
  return dados;
}

export function guardarApoio(id, dados) {
  cacheApoios.set(id, { id, ...dados });
}

export async function listarApoios(db, disciplina) {
  const snap = await getDocs(query(
    collection(db, "textosApoio"),
    where("disciplina", "==", disciplina),
    limit(200)
  ));
  return snap.docs.map((d) => {
    const apoio = { id: d.id, ...d.data() };
    cacheApoios.set(apoio.id, apoio);
    return apoio;
  });
}

// ---------- Seletor de imagens (componente do formulário) ----------
let contadorSeletores = 0;

export function criarSeletorImagens(container, { max = 4, rotuloBotao = "Adicionar imagem", db = null } = {}) {
  const idBase = `sel${++contadorSeletores}`;
  let itens = [];
  const ouvintes = [];
  const avisar = () => ouvintes.forEach((f) => f());

  const lista = el("div", "space-y-3");
  const erro = el("p", "mt-2 hidden text-sm font-bold text-alerta");
  erro.setAttribute("role", "alert");
  const botao = el("button", "mt-3 rounded-[10px] border-2 border-petroleo px-4 py-2 font-bold text-petroleo hover:bg-petroleo-claro", rotuloBotao);
  botao.type = "button";
  const entrada = document.createElement("input");
  entrada.type = "file";
  entrada.accept = "image/*";
  entrada.className = "hidden";
  container.replaceChildren(lista, erro, botao, entrada);

  function mostrarErro(texto) {
    erro.textContent = texto || "";
    erro.classList.toggle("hidden", !texto);
  }

  function desenhar() {
    lista.replaceChildren();
    itens.forEach((item, i) => {
      const cartao = el("div", "flex flex-col gap-3 rounded-lg border border-[#D5DDE4] p-3 sm:flex-row");

      const figura = document.createElement("img");
      figura.src = item.dataUrl;
      figura.alt = item.alt || "Imagem anexada";
      figura.className = "max-h-40 max-w-full self-start rounded border border-[#D5DDE4] bg-white object-contain";

      const lado = el("div", "flex-1");
      const idCampo = `${idBase}-alt-${i}`;
      const rotulo = el("label", "rotulo", "Descreva a imagem");
      rotulo.htmlFor = idCampo;
      const dica = el("p", "text-sm text-[#4B5C6B]", "Quem não enxerga a imagem precisa entender o que ela mostra. Ex.: Triângulo retângulo com catetos de 3 cm e 4 cm.");
      const campo = el("textarea", "campo mt-1");
      campo.id = idCampo;
      campo.rows = 2;
      campo.maxLength = 500;
      campo.value = item.alt || "";
      if (item.id) campo.readOnly = true;
      campo.addEventListener("input", () => {
        item.alt = campo.value;
        avisar();
      });

      const remover = el("button", "mt-2 text-sm font-bold text-alerta underline underline-offset-4", "Remover imagem");
      remover.type = "button";
      remover.addEventListener("click", () => {
        itens.splice(i, 1);
        desenhar();
        avisar();
      });

      lado.append(rotulo, dica, campo, remover);
      cartao.append(figura, lado);
      lista.appendChild(cartao);
    });
    botao.classList.toggle("hidden", itens.length >= max);
  }

  botao.addEventListener("click", () => entrada.click());

  entrada.addEventListener("change", async () => {
    const arquivo = entrada.files && entrada.files[0];
    entrada.value = "";
    if (!arquivo) return;
    mostrarErro("");
    botao.disabled = true;
    botao.textContent = "Preparando imagem…";
    try {
      const reduzida = await reduzirImagem(arquivo);
      itens.push({ dataUrl: reduzida.dataUrl, alt: "", largura: reduzida.largura, altura: reduzida.altura });
      desenhar();
      avisar();
      const campos = lista.querySelectorAll("textarea");
      if (campos.length) campos[campos.length - 1].focus();
    } catch (e) {
      mostrarErro(e.message || "Não foi possível usar esta imagem.");
    } finally {
      botao.disabled = false;
      botao.textContent = rotuloBotao;
    }
  });

  desenhar();

  return {
    getItens: () => itens,
    onChange: (fn) => ouvintes.push(fn),
    limpar() {
      itens = [];
      mostrarErro("");
      desenhar();
    },
    async carregarIds(ids) {
      const carregadas = await Promise.all((ids || []).map((id) => obterImagem(db, id)));
      itens = carregadas.filter(Boolean).map((img) => ({
        id: img.id, dataUrl: img.dataUrl, alt: img.alt, largura: img.largura, altura: img.altura
      }));
      desenhar();
      avisar();
    },
    // Devolve "" se estiver tudo certo, ou a mensagem de erro.
    validar() {
      const faltando = itens.some((item) => !item.id && item.alt.trim().length < 5);
      return faltando ? "Descreva cada imagem (pelo menos 5 letras)." : "";
    }
  };
}
