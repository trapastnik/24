/* МТК №24 — конфигурация 3D-моделей ориентиров (интерфейс «модели ↔ сцена»).
 *
 * ВЛАДЕЛЕЦ ЭТОГО ФАЙЛА: сессия генерации моделей.
 * scene.js этот файл только ЧИТАЕТ (через window.MTK24_MODELS) и не редактирует.
 * Здесь же сессия моделей подбирает size/yaw, не трогая scene.js.
 *
 *   dir        — папка с .glb (относительно index.html)
 *   cfg[key]   — { file, size, yaw }
 *     file     — имя .glb в dir
 *     size     — желаемый горизонтальный габарит в мировых единицах
 *     yaw      — доворот вокруг вертикали, радианы
 */
window.MTK24_MODELS = {
  dir: "./assets/models/",
  cfg: {
    smolny:    { file: "smolny.glb",    size: 4,    yaw: 0 },
    winter:    { file: "winter.glb",    size: 6,    yaw: 0 },
    fortress:  { file: "fortress.glb",  size: 6.5,  yaw: 0 },
    mariinsky: { file: "mariinsky.glb", size: 4,    yaw: 0 },
    tauride:   { file: "tauride.glb",   size: 5.5,  yaw: 0 },
    // «Аврора»: корпус модели по умолчанию вдоль X карты (поворот на 90° от прежнего −π/2).
    aurora:    { file: "aurora.glb",    size: 12,   yaw: 0 },
  },
};
