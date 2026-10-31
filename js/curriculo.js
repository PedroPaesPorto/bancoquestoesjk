// Taxonomia curricular usada nos formulários e filtros.
// Para incluir uma disciplina ou ano, basta editar as listas abaixo.

export const SEGMENTOS = {
  fundamental: {
    rotulo: "Ensino Fundamental",
    anos: ["6º ano", "7º ano", "8º ano", "9º ano"],
    disciplinas: [
      "Língua Portuguesa",
      "Matemática",
      "Ciências",
      "História",
      "Geografia",
      "Arte",
      "Educação Física",
      "Língua Inglesa",
      "Ensino Religioso"
    ]
  },
  medio: {
    rotulo: "Ensino Médio",
    anos: ["1ª série", "2ª série", "3ª série"],
    disciplinas: [
      "Língua Portuguesa",
      "Matemática",
      "Biologia",
      "Física",
      "Química",
      "História",
      "Geografia",
      "Filosofia",
      "Sociologia",
      "Arte",
      "Educação Física",
      "Língua Inglesa"
    ]
  }
};

export const BIMESTRES = [1, 2, 3, 4];

export const TIPOS = {
  multipla_escolha: "Múltipla escolha",
  discursiva: "Discursiva"
};

export const DIFICULDADES = {
  facil: "Fácil",
  media: "Média",
  dificil: "Difícil"
};

export const LETRAS = ["A", "B", "C", "D", "E"];
