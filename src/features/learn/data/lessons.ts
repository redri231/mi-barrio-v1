export type LearnLesson = {
  id: string;
  title: string;
  duration?: string;
  author?: string;
  source?: string;
  steps: string[];
};

export const tutorials: LearnLesson[] = [
  {
    id: 'u1',
    title: 'Cómo cambiar un caño que gotea',
    duration: '3 min',
    author: 'Guía inicial Mi Barrio',
    steps: [
      'Cierra la llave de paso del agua.',
      'Afloja la tuerca del caño con una llave inglesa.',
      'Pon cinta teflón en la rosca nueva.',
      'Ajusta el caño nuevo sin forzar.',
      'Abre el agua despacio y revisa que no gotee.',
    ],
  },
  {
    id: 'u2',
    title: 'Qué hacer si salta la llave térmica',
    duration: '2 min',
    author: 'Guía inicial Mi Barrio',
    steps: [
      'Desconecta los aparatos que estaban prendidos.',
      'Sube la palanca de la llave con la mano seca.',
      'Si vuelve a saltar, no insistas: llama a un electricista.',
    ],
  },
  {
    id: 'u3',
    title: 'Destapar un lavadero sin químicos',
    duration: '4 min',
    author: 'Guía inicial Mi Barrio',
    steps: [
      'Saca el agua que se acumuló.',
      'Usa un sopapo tapando bien el desagüe.',
      'Presiona y suelta 10 veces seguidas.',
      'Echa agua caliente para terminar.',
    ],
  },
];

export const protocols: LearnLesson[] = [
  {
    id: 'p1',
    title: 'Si hay un sismo',
    source: 'Referencia: INDECI · ¿Qué hacer en caso de sismo?',
    steps: [
      'Mantén la calma. No corras ni uses ascensores.',
      'Agáchate, cúbrete la cabeza y sujétate bajo una mesa firme.',
      'Aléjate de ventanas y objetos que puedan caer.',
      'Cuando pare, sal por la ruta de evacuación hacia la zona segura.',
      'Corta gas y luz si es seguro hacerlo.',
    ],
  },
  {
    id: 'p2',
    title: 'Si hay un incendio',
    source: 'Referencia: INDECI · Incendios urbanos',
    steps: [
      'Da la alarma y llama a Bomberos (116).',
      'Agáchate: el aire limpio está abajo.',
      'Cubre nariz y boca con un paño húmedo.',
      'Sal sin regresar por tus cosas.',
      'No uses ascensores.',
    ],
  },
  {
    id: 'p3',
    title: 'Si se corta el agua o la luz',
    steps: [
      'Revisa si el corte es solo en tu casa o en toda la cuadra.',
      'Guarda agua en baldes para beber y cocinar.',
      'Usa linterna, no velas.',
      'Desconecta aparatos sensibles hasta que vuelva el servicio.',
      'Avisa a tu coordinador barrial.',
    ],
  },
];
