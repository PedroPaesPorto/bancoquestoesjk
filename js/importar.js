import { SEGMENTOS, BIMESTRES, DIFICULDADES, TIPOS } from "./curriculo.js";
import { $, el } from "./util.js";
import { chamarIA } from "./ia.js";
import { iaConfigurada } from "./ia-config.js";
import { abrirImagem, abrirImagemDeUrl, reduzirFonte, reduzirDataUrl } from "./midia.js";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";

const MAX_PAGINAS = 30;
const LADO_PAGINA = 1800;
const PAGINAS_POR_LOTE = 2;
const TAMANHO_MAX_LOTE = 3300000; // caracteres em base64; o Vercel aceita pedidos de até 4,5 MB
const TAMANHO_MAX_PAGINA = 1400000;
const CARACTERES_POR_BLOCO = 5000;
const IMAGENS_POR_BLOCO = 5;
const MAX_IMAGENS_DOCX = 40;

const scriptsCarregados = new Map();
function carregarScript(url) {
  if (!scriptsCarregados.has(url)) {
    scriptsCarregados.set(url, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não consegui carregar o leitor de arquivos. Verifique a conexão."));
      document.head.appendChild(s);
    }));
  }
  return scriptsCarregados.get(url);
}

const dadosBase64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(",") + 1);
const mimeDe = (dataUrl) => dataUrl.slice(5, dataUrl.indexOf(";"));

// ---------- Preparação dos arquivos ----------
function paginaDeCanvas(canvas, rotulo) {
  let fonte = canvas;
  let qualidade = 0.8;
  let jpeg = "";
  for (let i = 0; i < 10; i++) {
    jpeg = fonte.toDataURL("image/jpeg", qualidade);
    if (jpeg.length <= TAMANHO_MAX_PAGINA) break;
    if (qualidade > 0.5) {
      qualidade -= 0.1;
    } else {
      const menor = document.createElement("canvas");
      menor.width = Math.round(fonte.width * 0.85);
      menor.height = Math.round(fonte.height * 0.85);
      menor.getContext("2d").drawImage(fonte, 0, 0, menor.width, menor.height);
      fonte = menor;
    }
  }
  return { canvas, jpeg, rotulo };
}

async function paginaDeImagem(arquivo) {
  const img = await abrirImagem(arquivo);
  const escala = Math.min(1, LADO_PAGINA / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const c = canvas.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(img, 0, 0, canvas.width, canvas.height);
  return paginaDeCanvas(canvas, arquivo.name);
}

async function paginasDePdf(arquivo, limite, aoProgresso) {
  await carregarScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const total = Math.min(pdf.numPages, limite);
  const paginas = [];
  for (let n = 1; n <= total; n++) {
    aoProgresso(`Lendo ${arquivo.name}: página ${n} de ${total}…`);
    const pagina = await pdf.getPage(n);
    const base = pagina.getViewport({ scale: 1 });
    const escala = LADO_PAGINA / Math.max(base.width, base.height);
    const viewport = pagina.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const c = canvas.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    await pagina.render({ canvasContext: c, viewport }).promise;
    paginas.push(paginaDeCanvas(canvas, `${arquivo.name} (página ${n})`));
  }
  return { paginas, truncado: pdf.numPages > limite };
}

// Word: extrai o texto e as imagens. Equações do editor do Word não são lidas.
function htmlParaTexto(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imagens = [];
  let saida = "";

  function percorrer(no) {
    if (no.nodeType === Node.TEXT_NODE) {
      saida += no.textContent;
      return;
    }
    if (no.nodeType !== Node.ELEMENT_NODE) return;
    const tag = no.tagName;
    if (tag === "IMG") {
      imagens.push(no.getAttribute("src") || "");
      saida += ` [[IMAGEM ${imagens.length - 1}]] `;
      return;
    }
    if (tag === "BR") {
      saida += "\n";
      return;
    }
    if (tag === "TABLE") {
      no.querySelectorAll("tr").forEach((linha) => {
        const celulas = Array.from(linha.children).map((c) => c.textContent.trim().replace(/\s+/g, " "));
        saida += `${celulas.join(" | ")}\n`;
      });
      return;
    }
    if (tag === "LI") saida += "- ";
    Array.from(no.childNodes).forEach(percorrer);
    if (["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "DIV", "UL", "OL", "BLOCKQUOTE"].includes(tag)) saida += "\n";
  }
  percorrer(doc.body);
  return { texto: saida.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), imagens };
}

async function blocosDeDocx(arquivo, aoProgresso) {
  await carregarScript(MAMMOTH);
  const mammoth = window.mammoth;
  aoProgresso(`Lendo ${arquivo.name}…`);
  const resultado = await mammoth.convertToHtml(
    { arrayBuffer: await arquivo.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement((imagem) =>
        imagem.read("base64").then((b64) => ({ src: `data:${imagem.contentType};base64,${b64}` })))
    }
  );
  const { texto, imagens } = htmlParaTexto(resultado.value);
  if (texto.length < 20) throw new Error("Não encontrei texto neste arquivo Word.");

  // Reduz cada imagem; formatos que o navegador não abre (como EMF) viram aviso no texto.
  const reduzidas = [];
  let textoFinal = texto;
  for (let i = 0; i < imagens.length; i++) {
    aoProgresso(`Preparando imagem ${i + 1} de ${imagens.length}…`);
    let pronta = null;
    if (i < MAX_IMAGENS_DOCX && /^data:image\/(png|jpeg|gif|webp)/.test(imagens[i])) {
      try {
        pronta = await reduzirDataUrl(imagens[i]);
      } catch (e) {
        pronta = null;
      }
    }
    reduzidas.push(pronta);
    if (!pronta) textoFinal = textoFinal.replace(`[[IMAGEM ${i}]]`, "[figura que não foi possível ler]");
  }

  // Divide em trechos pequenos e renumera as imagens dentro de cada trecho.
  const linhas = textoFinal.split("\n");
  const blocos = [];
  let linhasAtuais = [];
  let tamanho = 0;
  let globais = [];

  function fechar() {
    if (!linhasAtuais.length) return;
    let trecho = linhasAtuais.join("\n");
    const imagensDoBloco = globais.map((g) => reduzidas[g]);
    globais.forEach((g, local) => { trecho = trecho.split(`[[IMAGEM ${g}]]`).join(`[[IMAGEM ${local}]]`); });
    blocos.push({ texto: trecho, imagens: imagensDoBloco, rotulo: `${arquivo.name} (trecho ${blocos.length + 1})` });
    linhasAtuais = [];
    tamanho = 0;
    globais = [];
  }

  linhas.forEach((linha) => {
    const refs = Array.from(linha.matchAll(/\[\[IMAGEM (\d+)\]\]/g)).map((m) => Number(m[1]));
    if (linhasAtuais.length && (tamanho + linha.length > CARACTERES_POR_BLOCO || globais.length + refs.length > IMAGENS_POR_BLOCO)) fechar();
    linhasAtuais.push(linha);
    tamanho += linha.length + 1;
    refs.forEach((r) => { if (!globais.includes(r)) globais.push(r); });
  });
  fechar();
  return { blocos, avisos: resultado.messages.length ? ["Alguns elementos do Word (como equações) não puderam ser lidos. Se a prova tiver fórmulas, salve o arquivo como PDF e importe o PDF."] : [] };
}

// ---------- Recorte de figuras ----------
async function recortar(canvas, caixa, descricao) {
  const [ymin, xmin, ymax, xmax] = caixa;
  const folga = 15; // 1,5% de margem em cada lado
  const x0 = Math.max(0, Math.floor(((xmin - folga) / 1000) * canvas.width));
  const y0 = Math.max(0, Math.floor(((ymin - folga) / 1000) * canvas.height));
  const x1 = Math.min(canvas.width, Math.ceil(((xmax + folga) / 1000) * canvas.width));
  const y1 = Math.min(canvas.height, Math.ceil(((ymax + folga) / 1000) * canvas.height));
  const largura = Math.max(1, x1 - x0);
  const altura = Math.max(1, y1 - y0);

  const corte = document.createElement("canvas");
  corte.width = largura;
  corte.height = altura;
  corte.getContext("2d").drawImage(canvas, x0, y0, largura, altura, 0, 0, largura, altura);
  const reduzida = await reduzirFonte(corte, largura, altura);
  return { ...reduzida, alt: descricao.length >= 5 ? descricao : "Figura da questão" };
}

// ---------- Módulo ----------
export function iniciarImportar(ctx) {
  const area = document.getElementById("area-importar");
  if (!area) return { limpar() {} };

  let fonte = null;        // { tipo: "paginas" | "texto", itens: [...], truncado, avisos }
  let itensLidos = [];     // questões encontradas pela IA
  let fila = null;         // revisão em andamento
  let cancelado = false;
  let ocupado = false;

  area.innerHTML = `
    <h1 class="text-2xl font-bold sm:text-3xl">Importar prova de arquivo</h1>
    <p class="mt-1 text-[#33475B]">Envie fotos, um PDF ou um arquivo Word. A IA separa as questões e abre cada uma no formulário para você conferir e salvar, como se tivesse digitado.</p>

    <div id="im-aviso-config" class="mt-4 hidden rounded-xl border-2 border-marca bg-[#FFF6DB] p-4 text-sm">
      <strong>A IA ainda não foi configurada.</strong>
      Abra <code>js/ia-config.js</code> e cole o endereço do seu projeto no Vercel.
    </div>

    <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
      <legend class="px-1 text-lg font-bold">1. Para quem é a prova</legend>
      <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="rotulo" for="im-segmento">Segmento</label>
          <select id="im-segmento" class="campo"><option value="">Selecione o segmento</option>${
            Object.entries(SEGMENTOS).map(([v, s]) => `<option value="${v}">${s.rotulo}</option>`).join("")}</select>
        </div>
        <div>
          <label class="rotulo" for="im-ano">Ano / série</label>
          <select id="im-ano" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
        </div>
        <div>
          <label class="rotulo" for="im-disciplina">Disciplina</label>
          <select id="im-disciplina" class="campo" disabled><option value="">Escolha o segmento antes</option></select>
        </div>
        <div>
          <label class="rotulo" for="im-bimestre">Bimestre</label>
          <select id="im-bimestre" class="campo"><option value="">Selecione o bimestre</option>${
            BIMESTRES.map((n) => `<option value="${n}">${n}º bimestre</option>`).join("")}</select>
        </div>
      </div>
    </fieldset>

    <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
      <legend class="px-1 text-lg font-bold">2. O arquivo</legend>
      <label class="rotulo mt-2" for="im-arquivo">Fotos das páginas, PDF ou Word (.docx)</label>
      <input id="im-arquivo" type="file" multiple accept="image/*,.pdf,application/pdf,.docx" class="campo">
      <p class="mt-2 text-sm text-[#4B5C6B]">Dê preferência ao <strong>PDF</strong>: ele preserva fórmulas e figuras. No Word, fórmulas feitas no editor de equações não são lidas, e vale salvar como PDF antes. Até ${MAX_PAGINAS} páginas por vez.</p>
      <p id="im-status-arquivo" class="mt-3 hidden text-sm font-bold text-[#33475B]" aria-live="polite"></p>
      <p id="im-erro-arquivo" class="mt-3 hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>
      <ul id="im-paginas" class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"></ul>
      <label class="mt-4 flex items-start gap-3 font-bold">
        <input id="im-gabarito" type="checkbox" class="mt-1 h-5 w-5 accent-[#0F6B6B]">
        <span>O arquivo já traz o gabarito (respostas)
          <span class="block text-sm font-normal text-[#4B5C6B]">Se não trouxer, a IA sugere as respostas e avisa em cada questão. Confira sempre.</span>
        </span>
      </label>
    </fieldset>

    <fieldset class="mt-5 rounded-xl border border-[#D5DDE4] bg-white p-4 sm:p-5">
      <legend class="px-1 text-lg font-bold">3. Ler com IA</legend>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-[#33475B]">
        <li>Envie só material que você tem direito de usar, como provas que você mesmo elaborou.</li>
        <li>Não envie páginas com nomes de alunos.</li>
        <li>A IA pode errar, principalmente em fórmulas e figuras. Você confere cada questão antes de salvar.</li>
      </ul>
      <p id="im-erro" class="mt-3 hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>
      <div class="mt-4 flex flex-col gap-3 sm:flex-row">
        <button type="button" id="im-ler" class="btn sm:!w-auto sm:min-w-[14rem]">Ler com IA</button>
        <button type="button" id="im-cancelar" class="hidden rounded-[10px] border-2 border-[#9FB0BE] px-5 py-3 font-bold text-[#33475B]">Cancelar leitura</button>
      </div>
      <div id="im-progresso" class="mt-4 hidden" aria-live="polite">
        <div class="h-3 w-full overflow-hidden rounded-full bg-[#E3E9EE]"><div id="im-barra" class="h-3 w-0 bg-petroleo transition-all"></div></div>
        <p id="im-progresso-texto" class="mt-2 text-sm font-bold text-[#33475B]"></p>
      </div>
    </fieldset>

    <section id="im-resultado" class="mt-5 hidden rounded-xl border-2 border-petroleo bg-white p-4 sm:p-5">
      <h2 class="text-lg font-bold">Questões encontradas</h2>
      <p id="im-resumo" class="mt-1 text-[#33475B]"></p>
      <ul id="im-falhas" class="mt-2 list-disc space-y-1 pl-5 text-sm font-bold text-alerta"></ul>
      <ul id="im-lista" class="mt-4 space-y-2"></ul>
      <div class="mt-5 flex flex-col gap-3 sm:flex-row">
        <button type="button" id="im-revisar" class="btn sm:!w-auto">Revisar e salvar uma a uma</button>
        <button type="button" id="im-descartar" class="rounded-[10px] border-2 border-[#9FB0BE] px-5 py-3 font-bold text-alerta hover:bg-[#FBE9E4]">Descartar tudo</button>
      </div>
    </section>
  `;

  if (!iaConfigurada) $("#im-aviso-config", area).classList.remove("hidden");

  const selSegmento = $("#im-segmento", area);
  const selAno = $("#im-ano", area);
  const selDisciplina = $("#im-disciplina", area);

  // ----- Utilidades -----
  function mostrar(id, texto) {
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

  function progresso(percentual, texto) {
    $("#im-progresso", area).classList.remove("hidden");
    $("#im-barra", area).style.width = `${Math.max(2, Math.min(100, percentual))}%`;
    $("#im-progresso-texto", area).textContent = texto;
  }

  // ----- Arquivos -----
  function desenharPaginas() {
    const lista = $("#im-paginas", area);
    lista.replaceChildren();
    if (!fonte) return;

    if (fonte.tipo === "texto") {
      const trechos = fonte.itens.length;
      const imagens = fonte.itens.reduce((n, b) => n + b.imagens.filter(Boolean).length, 0);
      mostrar("#im-status-arquivo", `Arquivo Word pronto: ${trechos} trecho(s) e ${imagens} imagem(ns).`);
      return;
    }

    mostrar("#im-status-arquivo", `${fonte.itens.length} página(s) prontas.${fonte.truncado ? ` Só as primeiras ${MAX_PAGINAS} foram lidas.` : ""}`);
    fonte.itens.forEach((pagina, i) => {
      const item = el("li", "rounded-lg border border-[#D5DDE4] p-2");
      const miniatura = document.createElement("img");
      miniatura.src = pagina.jpeg;
      miniatura.alt = `Miniatura da página ${i + 1}`;
      miniatura.className = "h-32 w-full rounded bg-white object-contain";
      item.appendChild(miniatura);
      item.appendChild(el("p", "mt-1 text-xs font-bold text-[#33475B]", `Página ${i + 1}`));
      const remover = el("button", "mt-1 text-xs font-bold text-alerta underline underline-offset-4", "Remover");
      remover.type = "button";
      remover.addEventListener("click", () => {
        fonte.itens.splice(i, 1);
        if (fonte.itens.length === 0) fonte = null;
        desenharPaginas();
        if (!fonte) mostrar("#im-status-arquivo", "");
      });
      item.appendChild(remover);
      lista.appendChild(item);
    });
  }

  async function lerArquivos(arquivos) {
    mostrar("#im-erro-arquivo", "");
    mostrar("#im-status-arquivo", "");
    fonte = null;
    $("#im-paginas", area).replaceChildren();
    if (!arquivos.length) return;

    const ordenados = [...arquivos].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
    const docx = ordenados.filter((a) => /\.docx$/i.test(a.name));
    if (docx.length && ordenados.length > 1) {
      mostrar("#im-erro-arquivo", "Envie o arquivo Word sozinho, sem misturar com PDF ou fotos.");
      return;
    }
    if (ordenados.some((a) => /\.doc$/i.test(a.name))) {
      mostrar("#im-erro-arquivo", "Arquivos .doc antigos não são lidos. Salve como .docx ou PDF no Word e envie de novo.");
      return;
    }

    ocupado = true;
    const aviso = (t) => mostrar("#im-status-arquivo", t);
    try {
      if (docx.length) {
        aviso("Lendo o arquivo Word…");
        const { blocos, avisos } = await blocosDeDocx(docx[0], aviso);
        fonte = { tipo: "texto", itens: blocos, avisos, nome: docx[0].name };
      } else {
        const paginas = [];
        let truncado = false;
        for (const arquivo of ordenados) {
          const restante = MAX_PAGINAS - paginas.length;
          if (restante <= 0) { truncado = true; break; }
          if (/\.pdf$/i.test(arquivo.name) || arquivo.type === "application/pdf") {
            const r = await paginasDePdf(arquivo, restante, aviso);
            paginas.push(...r.paginas);
            truncado = truncado || r.truncado;
          } else if (arquivo.type.startsWith("image/")) {
            aviso(`Preparando ${arquivo.name}…`);
            paginas.push(await paginaDeImagem(arquivo));
          } else {
            throw new Error(`Não sei ler o arquivo ${arquivo.name}. Use PDF, Word (.docx) ou foto.`);
          }
        }
        fonte = { tipo: "paginas", itens: paginas, truncado, avisos: [], nome: ordenados.length === 1 ? ordenados[0].name : `${ordenados.length} arquivos` };
      }
      desenharPaginas();
      (fonte.avisos || []).forEach((a) => mostrar("#im-erro-arquivo", a));
    } catch (e) {
      console.error(e);
      fonte = null;
      mostrar("#im-status-arquivo", "");
      mostrar("#im-erro-arquivo", e.message || "Não foi possível ler o arquivo.");
    } finally {
      ocupado = false;
    }
  }

  // ----- Leitura com IA -----
  function formarLotes() {
    if (fonte.tipo === "texto") return fonte.itens.map((bloco) => [bloco]);
    const lotes = [];
    let atual = [];
    let tamanho = 0;
    fonte.itens.forEach((pagina) => {
      if (atual.length && (atual.length >= PAGINAS_POR_LOTE || tamanho + pagina.jpeg.length > TAMANHO_MAX_LOTE)) {
        lotes.push(atual);
        atual = [];
        tamanho = 0;
      }
      atual.push(pagina);
      tamanho += pagina.jpeg.length;
    });
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  async function figuraParaImagem(figura, lote) {
    if (!figura || figura.semRecorte) return null;
    try {
      if (fonte.tipo === "paginas") {
        const pagina = lote[figura.pagina];
        return pagina ? await recortar(pagina.canvas, figura.caixa, figura.descricao) : null;
      }
      const base = lote[0].imagens[figura.imagemRef];
      return base ? { ...base, alt: figura.descricao.length >= 5 ? figura.descricao : "Figura da questão" } : null;
    } catch (e) {
      console.warn("Recorte falhou:", e);
      return null;
    }
  }

  async function montarItens(resultado, lote, indiceLote) {
    const apoios = new Map();
    for (const apoio of resultado.textosApoio || []) {
      const imagens = [];
      let semRecorte = 0;
      for (const figura of apoio.figuras || []) {
        const img = await figuraParaImagem(figura, lote);
        if (img) imagens.push(img); else semRecorte++;
      }
      apoios.set(apoio.id, {
        chave: `${indiceLote}:${apoio.id}`,
        titulo: apoio.titulo,
        fonte: apoio.fonte,
        texto: apoio.texto,
        imagens,
        figurasSemRecorte: semRecorte
      });
    }

    const itens = [];
    for (const [n, q] of (resultado.questoes || []).entries()) {
      const figurasEnunciado = [];
      let semRecorte = 0;
      for (const figura of q.figurasEnunciado || []) {
        const img = await figuraParaImagem(figura, lote);
        if (img) figurasEnunciado.push(img); else semRecorte++;
      }
      const alternativas = [];
      for (const alt of q.alternativas || []) {
        let imagem = null;
        if (alt.figura) {
          imagem = await figuraParaImagem(alt.figura, lote);
          if (!imagem) semRecorte++;
        }
        alternativas.push({ letra: alt.letra, texto: alt.texto, imagem });
      }
      itens.push({
        chave: `${indiceLote}-${n}`,
        numero: q.numero,
        tipo: q.tipo,
        enunciado: q.enunciado,
        figurasEnunciado,
        alternativas,
        gabarito: q.gabarito,
        gabaritoOrigem: q.gabaritoOrigem,
        justificativa: q.justificativa,
        assunto: q.assunto,
        dificuldade: q.dificuldade,
        cortada: q.cortada,
        observacao: q.observacao || "",
        figurasSemRecorte: semRecorte,
        apoio: q.apoioId ? apoios.get(q.apoioId) || null : null,
        incluir: true
      });
    }
    return itens;
  }

  async function lerComIA() {
    mostrar("#im-erro", "");
    if (!iaConfigurada) { mostrar("#im-erro", "A IA ainda não foi configurada. Preencha js/ia-config.js."); return; }
    if (ocupado) { mostrar("#im-erro", "Espere terminar de preparar o arquivo."); return; }
    if (!selSegmento.value || !selAno.value || !selDisciplina.value || !$("#im-bimestre", area).value) {
      mostrar("#im-erro", "Escolha o segmento, o ano, a disciplina e o bimestre.");
      return;
    }
    if (!fonte || fonte.itens.length === 0) { mostrar("#im-erro", "Envie o arquivo da prova primeiro."); return; }

    const contexto = {
      segmento: selSegmento.value,
      ano: selAno.value,
      disciplina: selDisciplina.value,
      bimestre: Number($("#im-bimestre", area).value)
    };
    const temGabarito = $("#im-gabarito", area).checked;
    const lotes = formarLotes();

    cancelado = false;
    ocupado = true;
    itensLidos = [];
    $("#im-resultado", area).classList.add("hidden");
    $("#im-ler", area).disabled = true;
    $("#im-cancelar", area).classList.remove("hidden");

    const falhas = [];
    let lidos = 0;
    try {
      for (let i = 0; i < lotes.length; i++) {
        if (cancelado) break;
        progresso((i / lotes.length) * 100, `Lendo parte ${i + 1} de ${lotes.length}… cada parte leva de 15 a 60 segundos.`);
        const lote = lotes[i];
        const corpo = {
          modo: fonte.tipo,
          contexto: { segmento: SEGMENTOS[contexto.segmento].rotulo, ano: contexto.ano, disciplina: contexto.disciplina },
          documentoTemGabarito: temGabarito,
          parte: i + 1,
          totalPartes: lotes.length
        };
        if (fonte.tipo === "paginas") {
          corpo.paginas = lote.map((p) => ({ mime: "image/jpeg", dados: dadosBase64(p.jpeg) }));
        } else {
          corpo.texto = lote[0].texto;
          corpo.imagens = lote[0].imagens.filter(Boolean).map((img) => ({ mime: mimeDe(img.dataUrl), dados: dadosBase64(img.dataUrl) }));
          // Mantém o índice das imagens alinhado quando alguma não pôde ser lida.
          if (corpo.imagens.length !== lote[0].imagens.length) {
            lote[0].imagens = lote[0].imagens.filter(Boolean);
          }
        }

        try {
          const resposta = await chamarIA(ctx, "importar", corpo);
          const novos = await montarItens(resposta.resultado, lote, i);
          itensLidos.push(...novos);
          lidos++;
        } catch (e) {
          console.error(e);
          const rotulo = fonte.tipo === "paginas" ? `páginas ${i * PAGINAS_POR_LOTE + 1} em diante` : `trecho ${i + 1}`;
          falhas.push(`Não consegui ler (${rotulo}): ${e.message}`);
          if ([401, 403, 429].includes(e.status)) break;
        }
      }
    } finally {
      ocupado = false;
      $("#im-ler", area).disabled = false;
      $("#im-cancelar", area).classList.add("hidden");
      progresso(100, cancelado ? "Leitura cancelada." : "Leitura terminada.");
    }

    if (itensLidos.length === 0 && falhas.length === 0 && !cancelado) falhas.push("A IA não encontrou questões neste arquivo.");
    desenharResultado(falhas, lidos, lotes.length, contexto);
    try {
      await ctx.registrarAuditoria("importacao_lida", {
        arquivo: fonte.nome, partes: lotes.length, partesLidas: lidos, questoes: itensLidos.length
      });
    } catch (e) {
      console.warn(e);
    }
  }

  // ----- Resultado -----
  function desenharResultado(falhas, lidos, total, contexto) {
    const caixa = $("#im-resultado", area);
    caixa.classList.remove("hidden");
    caixa.dataset.contexto = JSON.stringify(contexto);

    $("#im-resumo", area).textContent =
      `${itensLidos.length} questão(ões) encontrada(s) em ${lidos} de ${total} parte(s). Nada foi salvo ainda. Desmarque o que não quiser importar.`;

    const listaFalhas = $("#im-falhas", area);
    listaFalhas.replaceChildren();
    falhas.forEach((f) => listaFalhas.appendChild(el("li", "", f)));

    const lista = $("#im-lista", area);
    lista.replaceChildren();
    itensLidos.forEach((item, i) => {
      const li = el("li", "rounded-lg border border-[#D5DDE4] p-3");
      const linha = el("label", "flex items-start gap-3");
      const caixaMarca = document.createElement("input");
      caixaMarca.type = "checkbox";
      caixaMarca.checked = item.incluir;
      caixaMarca.className = "mt-1 h-5 w-5 shrink-0 accent-[#0F6B6B]";
      caixaMarca.addEventListener("change", () => { item.incluir = caixaMarca.checked; });
      linha.appendChild(caixaMarca);

      const corpo = el("div", "min-w-0 flex-1");
      corpo.appendChild(el("p", "font-bold", `${item.numero ? `Questão ${item.numero}` : `Questão ${i + 1}`}: ${item.assunto || "sem assunto"}`));
      corpo.appendChild(el("p", "line-clamp-2 text-sm text-[#33475B]", item.enunciado));

      const selos = el("div", "mt-2 flex flex-wrap gap-2");
      const selo = (texto, alerta) => selos.appendChild(el("span",
        `rounded-full border px-3 py-0.5 text-xs font-bold ${alerta ? "border-marca bg-[#FFF6DB] text-[#6B4E00]" : "border-[#B9C4CE] text-[#33475B]"}`, texto));
      selo(TIPOS[item.tipo] || "");
      selo(DIFICULDADES[item.dificuldade] || "");
      if (item.apoio) selo("Com texto de apoio");
      if (item.gabaritoOrigem === "ia") selo("Gabarito sugerido pela IA", true);
      if (item.gabaritoOrigem === "nenhum") selo("Sem gabarito", true);
      if (item.cortada) selo("Pode estar incompleta", true);
      if (item.figurasSemRecorte > 0) selo(`${item.figurasSemRecorte} figura(s) para adicionar à mão`, true);
      corpo.appendChild(selos);
      linha.appendChild(corpo);
      li.appendChild(linha);
      lista.appendChild(li);
    });
    $("#im-revisar", area).disabled = itensLidos.length === 0;
    caixa.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ----- Revisão uma a uma (no formulário de nova questão) -----
  function abrirItem() {
    const item = fila.lista[fila.indice];
    ctx.aoRevisar(item, {
      posicao: fila.indice + 1,
      total: fila.lista.length,
      nomeArquivo: fila.nomeArquivo,
      contexto: fila.contexto,
      apoios: fila.apoios,
      aoFinalizar: aoFinalizarItem
    });
    location.hash = "#nova";
  }

  async function encerrar() {
    const resumo = `Importação encerrada: ${fila.salvas} salva(s), ${fila.puladas} pulada(s).`;
    try {
      await ctx.registrarAuditoria("importacao_concluida", {
        arquivo: fila.nomeArquivo, salvas: fila.salvas, puladas: fila.puladas
      });
    } catch (e) {
      console.warn(e);
    }
    fila = null;
    itensLidos = [];
    $("#im-resultado", area).classList.add("hidden");
    ctx.aviso(resumo);
    ctx.aoAlterar();
    location.hash = "#banco";
  }

  function aoFinalizarItem(resultado) {
    if (!fila) return;
    if (resultado === "salva") fila.salvas++;
    if (resultado === "pulada") fila.puladas++;
    if (resultado === "parada") { encerrar(); return; }
    fila.indice++;
    if (fila.indice >= fila.lista.length) { encerrar(); return; }
    abrirItem();
  }

  function iniciarRevisao() {
    const lista = itensLidos.filter((item) => item.incluir);
    if (lista.length === 0) { ctx.aviso("Marque pelo menos uma questão para importar.", "erro"); return; }
    const contexto = JSON.parse($("#im-resultado", area).dataset.contexto);
    fila = {
      lista, indice: 0, salvas: 0, puladas: 0, apoios: {},
      nomeArquivo: fonte ? fonte.nome : "arquivo importado",
      contexto
    };
    abrirItem();
  }

  function limpar() {
    fonte = null;
    itensLidos = [];
    fila = null;
    cancelado = true;
    $("#im-paginas", area).replaceChildren();
    $("#im-lista", area).replaceChildren();
    $("#im-resultado", area).classList.add("hidden");
    $("#im-progresso", area).classList.add("hidden");
    mostrar("#im-status-arquivo", "");
    mostrar("#im-erro-arquivo", "");
    mostrar("#im-erro", "");
  }

  // ----- Eventos -----
  selSegmento.addEventListener("change", sincronizarSegmento);
  $("#im-arquivo", area).addEventListener("change", (ev) => lerArquivos(Array.from(ev.target.files || [])));
  $("#im-ler", area).addEventListener("click", lerComIA);
  $("#im-cancelar", area).addEventListener("click", () => { cancelado = true; });
  $("#im-revisar", area).addEventListener("click", iniciarRevisao);
  $("#im-descartar", area).addEventListener("click", () => {
    itensLidos = [];
    $("#im-resultado", area).classList.add("hidden");
  });

  return { limpar };
}
