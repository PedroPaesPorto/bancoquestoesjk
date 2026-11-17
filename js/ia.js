import { iaUrl, iaConfigurada } from "./ia-config.js";

// Chama uma função de IA no Vercel enviando o login do usuário.
// ctx.obterToken() devolve o token do Firebase da pessoa logada.
export async function chamarIA(ctx, rota, corpo) {
  if (!iaConfigurada) {
    throw new Error("A IA ainda não foi configurada. Preencha o endereço em js/ia-config.js.");
  }

  if (typeof ctx.manterSessao === "function") ctx.manterSessao();
  const token = await ctx.obterToken();
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), 85000);

  let resposta;
  try {
    resposta = await fetch(`${iaUrl.replace(/\/$/, "")}/api/${rota}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
      signal: controle.signal
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("A IA demorou demais para responder. Tente de novo.");
    throw new Error("Não consegui falar com a IA. Verifique a conexão e o endereço em js/ia-config.js.");
  } finally {
    clearTimeout(limite);
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch (e) {
    dados = null;
  }

  if (!dados && !resposta.ok) {
    // O Vercel responde em texto (não em JSON) quando ele mesmo interrompe o pedido.
    const mensagens = {
      404: "A função da IA não foi encontrada. Confira o endereço em js/ia-config.js e se o deploy no Vercel terminou.",
      413: "Os arquivos ficaram grandes demais para enviar de uma vez. Use menos páginas ou ative a opção de uma página por vez.",
      502: "A IA ficou fora do ar por um instante. Tente de novo.",
      504: "A leitura demorou demais. Tente de novo; se repetir, ative a opção de uma página por vez."
    };
    const erro = new Error(mensagens[resposta.status] || `A IA não respondeu (código ${resposta.status}).`);
    erro.status = resposta.status;
    throw erro;
  }

  if (!resposta.ok || !dados || dados.ok === false) {
    console.error("Erro da IA:", resposta.status, dados);
    const base = (dados && dados.mensagem) || `A IA não respondeu (código ${resposta.status}).`;
    // O detalhe técnico ajuda a diagnosticar nos primeiros testes.
    const erro = new Error(dados && dados.detalhe ? `${base} Detalhe: ${dados.detalhe}` : base);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}
