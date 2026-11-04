import { el } from "./util.js";

// ---- Ajustes de segurança (edite aqui) ----
// Tempo sem mexer no sistema até a sessão ser encerrada.
export const LIMITE_INATIVIDADE_MS = 30 * 60 * 1000; // 30 minutos
// O aviso com contagem regressiva aparece neste tempo antes do fim.
export const AVISO_ANTES_MS = 60 * 1000; // 1 minuto
// false: ao fechar o navegador (ou a aba), a pessoa sai do sistema. Recomendado em computador compartilhado.
// true: o login fica salvo no navegador até a pessoa clicar em Sair.
export const MANTER_LOGIN_AO_FECHAR = false;

const CHECAGEM_MS = 10 * 1000;
const EVENTOS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];

// Guarda de sessão: encerra a sessão depois de um tempo sem atividade.
// Usa o relógio de verdade (Date.now), então funciona também se o computador dormir.
export function criarGuardaDeSessao({ aoExpirar, limite = LIMITE_INATIVIDADE_MS, aviso = AVISO_ANTES_MS }) {
  let ultima = Date.now();
  let intervalo = null;
  let ultimoMovimento = 0;
  let ativo = false;
  let dialogo = null;
  let relogio = null;

  function atividade() {
    if (dialogo) return; // com o aviso aberto, só os botões contam
    ultima = Date.now();
  }

  function movimento() {
    const agora = Date.now();
    if (agora - ultimoMovimento > 5000) {
      ultimoMovimento = agora;
      atividade();
    }
  }

  function fecharAviso() {
    if (relogio) clearInterval(relogio);
    relogio = null;
    if (dialogo) {
      dialogo.remove();
      dialogo = null;
    }
  }

  function encerrar() {
    fecharAviso();
    parar();
    aoExpirar();
  }

  function mostrarAviso(restanteMs) {
    const fim = Date.now() + restanteMs;
    dialogo = el("dialog", "w-[min(92vw,26rem)] rounded-xl p-0 text-tinta backdrop:bg-black/50");
    dialogo.setAttribute("aria-labelledby", "sessao-titulo");
    const corpo = el("div", "p-5");
    const titulo = el("h2", "text-lg font-bold", "Você ainda está aí?");
    titulo.id = "sessao-titulo";
    const contagem = el("p", "mt-2 text-[#33475B]");
    corpo.append(titulo, contagem);

    const botoes = el("div", "mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end");
    const sair = el("button", "rounded-[10px] border-2 border-[#9FB0BE] px-5 py-2.5 font-bold text-[#33475B]", "Sair agora");
    sair.type = "button";
    const continuar = el("button", "rounded-[10px] bg-petroleo px-5 py-2.5 font-bold text-white", "Continuar conectado");
    continuar.type = "button";
    botoes.append(sair, continuar);
    corpo.appendChild(botoes);
    dialogo.appendChild(corpo);

    function atualizar() {
      const segundos = Math.max(0, Math.ceil((fim - Date.now()) / 1000));
      contagem.textContent = `Por segurança, sua sessão será encerrada em ${segundos} segundo(s) por falta de atividade. O que ainda não foi salvo será perdido.`;
      if (segundos <= 0) encerrar();
    }

    continuar.addEventListener("click", () => {
      fecharAviso();
      ultima = Date.now();
    });
    sair.addEventListener("click", encerrar);
    dialogo.addEventListener("cancel", (ev) => ev.preventDefault()); // Esc não decide por você

    document.body.appendChild(dialogo);
    dialogo.showModal();
    continuar.focus();
    atualizar();
    relogio = setInterval(atualizar, 1000);
  }

  function verificar() {
    if (!ativo) return;
    const parado = Date.now() - ultima;
    if (parado >= limite) {
      encerrar();
    } else if (parado >= limite - aviso && !dialogo) {
      mostrarAviso(limite - parado);
    }
  }

  const aoVoltarParaAba = () => { if (!document.hidden) verificar(); };

  function iniciar() {
    if (ativo) { ultima = Date.now(); return; }
    ativo = true;
    ultima = Date.now();
    EVENTOS.forEach((e) => document.addEventListener(e, atividade, { passive: true, capture: true }));
    document.addEventListener("pointermove", movimento, { passive: true, capture: true });
    document.addEventListener("visibilitychange", aoVoltarParaAba);
    window.addEventListener("focus", verificar);
    intervalo = setInterval(verificar, CHECAGEM_MS);
  }

  function parar() {
    if (!ativo) return;
    ativo = false;
    EVENTOS.forEach((e) => document.removeEventListener(e, atividade, { capture: true }));
    document.removeEventListener("pointermove", movimento, { capture: true });
    document.removeEventListener("visibilitychange", aoVoltarParaAba);
    window.removeEventListener("focus", verificar);
    if (intervalo) clearInterval(intervalo);
    intervalo = null;
    fecharAviso();
  }

  // Para tarefas longas (como a leitura de uma prova pela IA) avisarem que há trabalho em andamento.
  return { iniciar, parar, ping: atividade };
}
