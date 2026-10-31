import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

function htmlImportacao() {
  return `
    <h1 class="text-2xl font-bold sm:text-3xl">Importação Inteligente com IA</h1>
    <p class="mt-1 text-[#33475B]">Suba a foto, PDF ou documento da prova antiga. A IA vai extrair e organizar as questões para você.</p>

    <div class="mt-6 rounded-xl border border-[#D5DDE4] bg-white p-5 sm:p-6 shadow-sm">
      <form id="form-importar" class="space-y-5">
        <div>
          <label class="rotulo" for="imp-chave-gemini">Chave de API do Gemini (Google AI Studio)</label>
          <input id="imp-chave-gemini" type="password" class="campo" placeholder="Cole sua API Key do Gemini aqui" autocomplete="off">
          <p class="mt-1 text-xs text-[#4B5C6B]">A chave fica salva apenas no seu navegador para chamadas gratuitas da API.</p>
        </div>

        <div>
          <label class="rotulo" for="imp-arquivo">Selecione o arquivo da prova (PDF, Imagem ou TXT)</label>
          <input id="imp-arquivo" type="file" accept="application/pdf,image/*,text/plain" class="campo cursor-pointer">
        </div>

        <div>
          <label class="rotulo" for="imp-texto-manual">Ou cole o texto completo da prova abaixo</label>
          <textarea id="imp-texto-manual" rows="6" class="campo" placeholder="Cole o texto da prova aqui se preferir..."></textarea>
        </div>

        <p id="imp-erro" class="hidden rounded-lg bg-[#FBE9E4] p-3 text-sm font-bold text-alerta" role="alert"></p>

        <button type="submit" id="btn-processar-ia" class="btn sm:!w-auto">
          <svg class="ico" aria-hidden="true"><use href="#i-ia"/></svg>
          Extrair Questões com IA
        </button>
      </form>
    </div>

    <!-- Resultados Extraídos -->
    <section id="area-resultados-ia" class="mt-8 hidden space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold">Questões Encontradas pela IA</h2>
        <button type="button" id="btn-salvar-todas-ia" class="btn sm:!w-auto">Salvar Todas no Banco</button>
      </div>

      <ul id="lista-questoes-extraidas" class="space-y-4"></ul>
    </section>
  `;
}

// Converte arquivo para Base64 para enviar ao Gemini
function arquivoParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export function iniciarImportacao(ctx) {
  const area = document.getElementById("area-importacao");
  if (!area) return;
  area.innerHTML = htmlImportacao();

  const form = $("#form-importar", area);
  const erro = $("#imp-erro", area);
  const btnProcessar = $("#btn-processar-ia", area);
  const campoChave = $("#imp-chave-gemini", area);
  let questoesExtraidas = [];

  // Restaura a API Key do localStorage se existir
  campoChave.value = localStorage.getItem("gemini_api_key") || "";

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.classList.add("hidden");

    const apiKey = campoChave.value.trim();
    if (!apiKey) {
      erro.textContent = "Digite ou cole sua chave da API do Gemini para continuar.";
      erro.classList.remove("hidden");
      return;
    }

    localStorage.setItem("gemini_api_key", apiKey);

    const arquivo = $("#imp-arquivo", area).files[0];
    const textoManual = $("#imp-texto-manual", area).value.trim();

    if (!arquivo && !textoManual) {
      erro.textContent = "Selecione um arquivo de prova ou cole o texto no campo indicado.";
      erro.classList.remove("hidden");
      return;
    }

    btnProcessar.disabled = true;
    btnProcessar.textContent = "Processando com a IA...";

    try {
      let contents = [];
      const promptInstrucao = `
Você é um assistente pedagógico especializado em organizar provas escolares.
Analise a prova enviada e extraia todas as questões contidas nela.

Para cada questão extraída, retorne um objeto JSON contendo exatamente as seguintes chaves:
- "segmento": "fundamental" ou "medio"
- "ano": ex "7º ano" ou "1ª série"
- "disciplina": disciplina identificada (ex: Ciências, Biologia, Matemática)
- "bimestre": número de 1 a 4 (se não souber, coloque 1)
- "assunto": tema principal da questão (ex: Fotossíntese)
- "habilidade": código BNCC se identificado ou string vazia ""
- "tipo": "multipla_escolha" ou "discursiva"
- "dificuldade": "facil", "media" ou "dificil"
- "enunciado": texto limpo e completo do enunciado
- "alternativas": lista de objetos [{"letra": "A", "texto": "..."}, ...] (se for múltipla escolha, senão lista vazia [])
- "gabarito": a letra da correta (ex: "A") ou o texto da resposta esperada para discursivas
- "justificativa": breve explicação ou justificativa da resposta

Responda ESTRITAMENTE em formato JSON válido, como uma lista de objetos:
[
  { ... },
  { ... }
]
Não inclua marcadores de código como \`\`\`json. Responda apenas o JSON.
`;

      if (arquivo) {
        const base64Data = await arquivoParaBase64(arquivo);
        contents = [
          {
            parts: [
              { text: promptInstrucao },
              {
                inline_data: {
                  mime_type: arquivo.type,
                  data: base64Data
                }
              }
            ]
          }
        ];
      } else {
        contents = [
          {
            parts: [
              { text: `${promptInstrucao}\n\nTexto da prova:\n${textoManual}` }
            ]
          }
        ];
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Erro na comunicação com a API.");

      let respostaTexto = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      respostaTexto = respostaTexto.replace(/```json/g, "").replace(/```/g, "").trim();

      questoesExtraidas = JSON.parse(respostaTexto);
      desenharPrevia(questoesExtraidas);
      ctx.aviso(`${questoesExtraidas.length} questão(ões) extraída(s) com sucesso!`);
    } catch (e) {
      console.error(e);
      erro.textContent = `Erro ao processar prova: ${e.message}`;
      erro.classList.remove("hidden");
    } finally {
      btnProcessar.disabled = false;
      btnProcessar.textContent = "Extrair Questões com IA";
    }
  });

  function desenharPrevia(lista) {
    const areaRes = $("#area-resultados-ia", area);
    const ul = $("#lista-questoes-extraidas", area);
    ul.innerHTML = "";

    if (lista.length === 0) {
      areaRes.classList.add("hidden");
      return;
    }

    areaRes.classList.remove("hidden");

    lista.forEach((q, idx) => {
      const li = document.createElement("li");
      li.className = "rounded-xl border border-[#D5DDE4] bg-white p-5 space-y-3";
      li.innerHTML = `
        <div class="flex items-center justify-between border-b border-[#E3E9EE] pb-2">
          <span class="font-bold text-petroleo">Questão ${idx + 1} (${q.disciplina || 'Disciplina não informada'} - ${q.assunto || 'Sem assunto'})</span>
          <span class="text-xs bg-[#E3F1F0] text-petroleo-escuro px-2.5 py-1 rounded-full font-bold">${q.tipo}</span>
        </div>
        <p class="whitespace-pre-wrap font-semibold">${q.enunciado}</p>
        ${q.tipo === "multipla_escolha" ? `
          <ul class="space-y-1 text-sm">
            ${(q.alternativas || []).map(a => `<li class="${a.letra === q.gabarito ? 'font-bold text-petroleo' : ''}">${a.letra}) ${a.texto}</li>`).join('')}
          </ul>
        ` : `<p class="text-sm"><strong>Gabarito:</strong> ${q.gabarito}</p>`}
      `;
      ul.appendChild(li);
    });
  }

  // Salva todas as questões extraídas no Firestore
  $("#btn-salvar-todas-ia", area).addEventListener("click", async () => {
    if (questoesExtraidas.length === 0) return;

    try {
      for (const q of questoesExtraidas) {
        await addDoc(collection(ctx.db, "questoes"), {
          segmento: q.segmento || "fundamental",
          ano: q.ano || "6º ano",
          disciplina: q.disciplina || "Geral",
          bimestre: Number(q.bimestre) || 1,
          assunto: q.assunto || "Geral",
          habilidade: q.habilidade || "",
          tipo: q.tipo || "multipla_escolha",
          dificuldade: q.dificuldade || "media",
          enunciado: q.enunciado,
          alternativas: q.alternativas || [],
          gabarito: q.gabarito,
          justificativa: q.justificativa || "",
          criadoPorUid: ctx.estado.usuario.uid,
          criadoPor: ctx.estado.perfil.nome,
          cargo: ctx.estado.perfil.cargo,
          criadoEm: serverTimestamp(),
          ultimaModificacaoPor: ctx.estado.perfil.nome,
          ultimaModificacaoEm: serverTimestamp(),
          statusValidacao: "pendente"
        });
      }

      await ctx.registrarAuditoria("importacao_ia_sucesso", { quantidade: questoesExtraidas.length });
      ctx.aviso(`${questoesExtraidas.length} questão(ões) salvas no banco com sucesso!`);
      $("#area-resultados-ia", area).classList.add("hidden");
      location.hash = "#banco";
    } catch (e) {
      console.error(e);
      ctx.aviso("Erro ao salvar algumas questões no banco.", "erro");
    }
  });
}
