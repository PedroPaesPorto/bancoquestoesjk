import { el } from "./util.js";

// Janela de confirmação reutilizável.
// Devolve { ok, motivo, valor }.
//  - pedirMotivo: mostra um campo de texto obrigatório (mínimo 5 letras)
//  - escolha: { rotulo, opcoes: [{ valor, rotulo }] } mostra uma lista obrigatória
export function perguntar({ titulo, texto, rotuloOk, pedirMotivo = false, perigo = false, escolha = null }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", "w-[min(92vw,28rem)] rounded-xl p-0 text-tinta backdrop:bg-black/50");
    const corpo = el("div", "p-5");
    corpo.appendChild(el("h2", "text-lg font-bold", titulo));
    corpo.appendChild(el("p", "mt-2 text-[#33475B]", texto));

    let campoMotivo = null;
    let campoEscolha = null;

    if (escolha) {
      const rotulo = el("label", "rotulo mt-4", escolha.rotulo);
      campoEscolha = el("select", "campo");
      campoEscolha.id = "dialogo-escolha";
      rotulo.htmlFor = campoEscolha.id;
      const vazio = el("option", "", "Selecione");
      vazio.value = "";
      campoEscolha.appendChild(vazio);
      escolha.opcoes.forEach((o) => {
        const op = el("option", "", o.rotulo);
        op.value = o.valor;
        campoEscolha.appendChild(op);
      });
      corpo.append(rotulo, campoEscolha);
    }

    if (pedirMotivo) {
      const rotulo = el("label", "rotulo mt-4", "Motivo");
      campoMotivo = el("textarea", "campo");
      campoMotivo.rows = 3;
      campoMotivo.maxLength = 500;
      campoMotivo.id = "dialogo-motivo";
      rotulo.htmlFor = campoMotivo.id;
      corpo.append(rotulo, campoMotivo);
    }

    const aviso = el("p", "mt-2 hidden text-sm font-bold text-alerta");
    aviso.setAttribute("role", "alert");
    corpo.appendChild(aviso);

    const botoes = el("div", "mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end");
    const cancelar = el("button", "rounded-[10px] border-2 border-[#9FB0BE] px-5 py-2.5 font-bold text-[#33475B]", "Cancelar");
    cancelar.type = "button";
    const confirmar = el("button", "rounded-[10px] px-5 py-2.5 font-bold text-white " + (perigo ? "bg-alerta" : "bg-petroleo"), rotuloOk);
    confirmar.type = "button";
    botoes.append(cancelar, confirmar);
    corpo.appendChild(botoes);
    dlg.appendChild(corpo);

    let resultado = { ok: false, motivo: "", valor: "" };

    function erro(mensagem, campo) {
      aviso.textContent = mensagem;
      aviso.classList.remove("hidden");
      campo.focus();
    }

    cancelar.addEventListener("click", () => dlg.close());
    confirmar.addEventListener("click", () => {
      if (campoEscolha && !campoEscolha.value) {
        erro("Escolha uma opção.", campoEscolha);
        return;
      }
      if (campoMotivo && campoMotivo.value.trim().length < 5) {
        erro("Explique o motivo com pelo menos 5 letras.", campoMotivo);
        return;
      }
      resultado = {
        ok: true,
        motivo: campoMotivo ? campoMotivo.value.trim() : "",
        valor: campoEscolha ? campoEscolha.value : ""
      };
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(resultado);
    });

    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
