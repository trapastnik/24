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
    // ТЕСТ: вместо Смольного — кирпичный магазин (Poly/FBX, конверт. assimp). Вернуть: file → "smolny.glb".
    smolny:    { file: "brick_shop.glb", size: 9,   yaw: 0 },
    winter:    { file: "winter.glb",    size: 6,    yaw: 0 },
    fortress:  { file: "fortress.glb",  size: 6.5,  yaw: 0 },
    mariinsky: { file: "mariinsky.glb", size: 4,    yaw: 0 },
    tauride:   { file: "tauride.glb",   size: 5.5,  yaw: 0 },
    // «Аврора»: корпус модели по умолчанию вдоль X карты (поворот на 90° от прежнего −π/2).
    aurora:    { file: "aurora.glb",    size: 12,   yaw: 0 },

    // --- простые типовые модели вместо кубов-плейсхолдеров (size/yaw тюнятся на точку) ---
    // присутственные места / учреждения (civic.glb):
    admiralty:         { file: "civic.glb",   size: 8,   yaw: 0 },
    war_ministry:      { file: "civic.glb",   size: 6,   yaw: 0 },
    gosbank:           { file: "civic.glb",   size: 6,   yaw: 0 },
    post_main:         { file: "civic.glb",   size: 6,   yaw: 0 },
    telegraph_central: { file: "civic.glb",   size: 5,   yaw: 0 },
    telegraph_agency:  { file: "civic.glb",   size: 5,   yaw: 0 },
    telephone_central: { file: "civic.glb",   size: 5,   yaw: 0 },
    typography_trud:   { file: "civic.glb",   size: 5,   yaw: 0 },
    // вокзалы (station.glb — зал + часовая башня):
    nik_station:       { file: "station.glb", size: 10,  yaw: 0 },
    balt_station:      { file: "station.glb", size: 9,   yaw: 0 },
    warsaw_station:    { file: "station.glb", size: 9,   yaw: 0 },
    finland_station:   { file: "station.glb", size: 9,   yaw: 0 },
    tsarskoselsky:     { file: "station.glb", size: 9,   yaw: 0 },
    primorsky:         { file: "station.glb", size: 8,   yaw: 0 },
    // жилые / казармы (house.glb — блок + двускатка):
    barracks_litovsky: { file: "house.glb",   size: 8,   yaw: 0 },
    fofanova:          { file: "house.glb",   size: 4,   yaw: 0 },
    // промздание (works.glb — корпус + труба):
    power_station:     { file: "works.glb",   size: 6,   yaw: 0 },
  },
};
