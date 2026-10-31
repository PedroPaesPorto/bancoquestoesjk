// Cole aqui os dados do seu app web do Firebase:
// Console Firebase > Configurações do projeto > Seus apps > App da Web > "Configuração do SDK"
export const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

// Identificação da escola (aparece no cabeçalho das provas nos próximos passos)
export const escola = {
  nome: "Nome da Escola",
  cidade: "Porto Velho - RO"
};

export const configurado = !firebaseConfig.apiKey.startsWith("COLE_");
