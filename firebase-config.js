// Cole aqui os dados do seu app web do Firebase:
// Console Firebase > Configurações do projeto > Seus apps > App da Web > "Configuração do SDK"
const firebaseConfig = {
  apiKey: "AIzaSyCtl457XqXHV9ybPgqj1VLcBqb6r0WT-TI",
  authDomain: "banco-de-questoes-jk.firebaseapp.com",
  projectId: "banco-de-questoes-jk",
  storageBucket: "banco-de-questoes-jk.firebasestorage.app",
  messagingSenderId: "158529345274",
  appId: "1:158529345274:web:4fab7390f277fa79061b43"
};

// Identificação da escola (aparece no cabeçalho das provas nos próximos passos)
export const escola = {
  nome: "Escola Estadual de Ensino Fundamental e Médio John Kennedy",
  cidade: "Porto Velho - RO"
};

export const configurado = !firebaseConfig.apiKey.startsWith("COLE_");
