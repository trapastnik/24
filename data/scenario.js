/* МТК №24 «Ленин в октябре» — сценарный план видео-проекции «24–25 октября 1917».
 *
 * Источник: «Сценарный план МТК-24 (5)». Хронометраж 0:00–4:30 (270 с).
 * Принцип: каждый кадр — точки на карте, которые загораются/пульсируют/меняют
 * цвет; движение отрядов — по улицам (трассировка). Цвета сил:
 *   ВРК            — жёлтый с красной звездой (force: 'vrk')
 *   Врем. прав-во  — чёрный                   (force: 'pg')
 *   захвачено ВРК  — красный                  (state: 'red')
 *
 * Координаты точек и маршрутов берутся из data/locations.js (нормированные
 * [u,v] по карте). Здесь — тайминг, текст диктора, цитаты, иллюстрации,
 * состояния точек, маршруты и спецэффекты каждого кадра.
 *
 * Озвучки пока нет — оставлены слоты: поле `vo` (файл) и тайминг кадра, под
 * которые позже подкладывается голос; на экране показываются титры (`narration`).
 */
window.MTK24_SCENARIO = {
  duration: 270,           // секунд, 4:30
  fps: 30,                 // для возможного экспорта в видео

  // глобальная подпись таймлайна — двое суток событий
  clockStart: "24 октября, утро",
  clockEnd: "26 октября, ночь",

  shots: [
    {
      id: "intro", t0: 0, t1: 10,
      label: "Вступление", date: "24 октября 1917",
      title: "Город накануне",
      narration: "24 октября 1917 года. Петроград. Два центра власти. Смольный — штаб большевиков. Зимний — цитадель Временного правительства. Между ними — город, который к утру 25-го станет другим.",
      illustration: "intro_petrograd",
      illCaption: "Панорама Петрограда с Невы, 1917",
      focus: ["smolny", "winter"], framing: "wide",
      points: [
        { key: "smolny", force: "vrk", pulse: true },
        { key: "winter", force: "pg" },
        { key: "mariinsky", force: "pg" },
      ],
      vo: null,
    },
    {
      id: "typography", t0: 10, t1: 30,
      label: "Кадр 1", date: "5:30 — около 11 утра, 24 октября",
      title: "Первый удар. Типография",
      narration: "Пять тридцать утра 24 октября. Юнкера закрывают типографию «Труд» — здесь печатается большевистская «Правда» под названием «Рабочий путь». Захвачен весь тираж. Военно-революционный комитет рассылает «Предписание №1»: боевая готовность. Около 11 часов рота Литовского резервного полка вытесняет юнкеров. Газета выходит.",
      illustration: "k1_rabochiy_put",
      illCaption: "Первая полоса газеты «Рабочий путь», 24 октября 1917",
      focus: ["typography_trud"], framing: "tight",
      points: [
        { key: "fortress", force: "vrk", note: "перешла на сторону ВРК вечером 23-го" },
        { key: "typography_trud", force: "pg" },
        { key: "barracks_litovsky", force: "vrk" },
        { key: "typography_trud", at: 0.55, becomes: "red" },
      ],
      routes: [{ key: "litovsky_to_trud", force: "vrk", at: 0.3, dur: 0.4 }],
      vo: null,
    },
    {
      id: "bridges", t0: 30, t1: 60,
      label: "Кадр 2", date: "В течение дня 24 октября",
      title: "Мосты. Битва за переправы",
      narration: "Правительство приказывает развести мосты — отрезать рабочие районы от центра. В течение дня отряды Военно-революционного комитета предотвращают разводку и берут под контроль Литейный, Троицкий, Гренадерский и Сампсониевский мосты. Юнкерам удаётся удержать лишь Николаевский мост и ненадолго — Дворцовый.",
      illustration: null,
      illCaption: "Мосты Петрограда до 1917 года",
      focus: ["liteyny_br", "troitsky_br", "dvortsovy_br"], framing: "wide",
      points: [
        { key: "liteyny_br", force: "pg", becomes: "red", at: 0.35 },
        { key: "troitsky_br", force: "pg", pulse: true, becomes: "red", at: 0.5 },
        { key: "grenadersky_br", force: "vrk" },
        { key: "sampsonievsky_br", force: "vrk" },
        { key: "nikolaevsky_br", force: "pg", note: "разведён юнкерами" },
        { key: "dvortsovy_br", force: "pg", note: "удерживается" },
        { key: "winter", force: "pg", ringBlack: true, note: "подкрепления к Зимнему" },
      ],
      vo: null,
    },
    {
      id: "telegraph", t0: 60, t1: 100,
      label: "Кадр 3", date: "≈17:00 — 20:00, 24 октября",
      title: "Телеграф и связь",
      narration: "Около 17 часов комиссар ВРК с караулом Кексгольмского полка занимает Центральный телеграф. К 20:00 матросы берут Петроградское телеграфное агентство. Военно-революционный комитет шлёт телеграммы в Кронштадт и Гельсингфорс: кораблям флота — идти на Петроград.",
      illustration: null,
      illCaption: "Здание Центрального телеграфа, Петроград",
      focus: ["telegraph_central", "telegraph_agency", "balt_station"], framing: "tight",
      points: [
        { key: "telegraph_central", force: "pg", becomes: "red", at: 0.25 },
        { key: "telegraph_agency", force: "pg", becomes: "red", at: 0.55 },
        { key: "balt_station", force: "pg", becomes: "red", at: 0.8 },
      ],
      fx: [{ type: "telegrams", from: "smolny", to: ["kronstadt_dir", "helsingfors_dir"], at: 0.4 }],
      vo: null,
    },
    {
      id: "lenin", t0: 100, t1: 120,
      label: "Кадр 4", date: "Поздний вечер 24 октября",
      title: "Ленин идёт в Смольный",
      narration: "Поздним вечером Ленин, загримированный под рабочего, в сопровождении Эйно Рахьи через весь город идёт в Смольный. На пути — патруль юнкеров. Проходят. В Смольном Ленин появляется около 11 вечера и требует действовать решительнее.",
      illustration: "k4_smolny_entrance",
      illCaption: "У входа в Смольный — штаб большевиков, 1917 (РНБ)",
      quote: "Ушёл туда, куда Вы не хотели, чтобы я уходил. Ильич.",
      cite: "Записка В.И. Ленина М.В. Фофановой, 24 октября (6 ноября) 1917 г.",
      focus: ["fofanova", "smolny"], framing: "route",
      points: [
        { key: "fofanova", force: "vrk", pulse: true },
        { key: "smolny", force: "vrk" },
      ],
      routes: [{ key: "lenin_route", force: "vrk", marker: "dot", at: 0.1, dur: 0.85, pauses: true }],
      vo: null,
    },
    {
      id: "night", t0: 120, t1: 150,
      label: "Кадр 5", date: "Ночь с 24 на 25 октября",
      title: "Ночь. Точечный захват",
      narration: "Ночь с 24 на 25 октября. Планомерный, точечный захват города. Почтамт. Вокзалы. Банк. Телефонная станция. В Зимнем гаснет свет — электростанция теперь у восставших. К утру весь город красный — кроме одной точки. Зимний дворец ещё чёрный, в кольце.",
      illustration: null,
      illCaption: "Историческая карта Петрограда с объектами захвата",
      focus: ["post_main", "nik_station", "power_station", "gosbank"], framing: "wide",
      // огни загораются красным строго по хронологии (at = доля кадра)
      points: [
        { key: "post_main", force: "pg", becomes: "red", at: 0.08, time: "01:25" },
        { key: "nik_station", force: "pg", becomes: "red", at: 0.22, time: "02:00" },
        { key: "power_station", force: "pg", becomes: "red", at: 0.36, time: "02:00", killWinterLight: true },
        { key: "nikolaevsky_br", force: "pg", becomes: "red", at: 0.5, time: "02:00–03:30" },
        { key: "gosbank", force: "pg", becomes: "red", at: 0.66, time: "≈06:00" },
        { key: "telephone_central", force: "pg", becomes: "red", at: 0.8, time: "≈07:00" },
        { key: "warsaw_station", force: "pg", becomes: "red", at: 0.92, time: "08:00" },
        { key: "winter", force: "pg", ringRed: true },
      ],
      vo: null,
    },
    {
      id: "proclamation", t0: 150, t1: 180,
      label: "Кадр 6", date: "10 утра, 25 октября",
      title: "Воззвание «К гражданам России»",
      narration: "10 утра 25 октября. Ленин пишет воззвание «К гражданам России»: Временное правительство низложено, власть перешла к Военно-революционному комитету. В 11 часов Керенский покидает Петроград на автомобиле американского посольства.",
      illustration: null,
      illCaption: "Воззвание «К гражданам России», 25 октября 1917",
      quote: "Временное правительство низложено. Государственная власть перешла в руки органа Петроградского Совета рабочих и солдатских депутатов — Военно-революционного комитета.",
      cite: "Воззвание ВРК «К гражданам России», 25 октября 1917 г.",
      focus: ["smolny"], framing: "wide",
      points: [{ key: "smolny", force: "vrk", pulse: true }],
      fx: [{ type: "wave", from: "smolny", at: 0.3 }, { type: "flash", at: 0.66 }],
      vo: null,
    },
    {
      id: "ring", t0: 180, t1: 200,
      label: "Кадр 7", date: "В течение дня 25 октября",
      title: "Кольцо вокруг Зимнего",
      narration: "Отряды ВРК без сопротивления занимают правительственные объекты. Силы восстания окружают Зимний. Внутри — министры, их защищают юнкера, рота женского батальона и казаки при артиллерии. В 18:30 ВРК направляет ультиматум о сдаче под угрозой обстрела с «Авроры». Ответа нет. Штурм откладывается — не готовы сигнальные средства.",
      illustration: "k7_bronevik",
      illCaption: "Броневик «Лейтенант Шмидт», 25 октября 1917 (фото П.А. Оцупа)",
      focus: ["winter"], framing: "tight",
      points: [
        { key: "finland_station", force: "pg", becomes: "red", at: 0.15 },
        { key: "mariinsky", force: "pg", becomes: "red", at: 0.3 },
        { key: "admiralty", force: "pg", becomes: "red", at: 0.45 },
        { key: "war_ministry", force: "pg", becomes: "red", at: 0.6 },
        { key: "winter", force: "pg", pulse: true, encircle: true },
        { key: "aurora", force: "vrk", onNeva: true },
      ],
      fx: [{ type: "ring", around: "winter", at: 0.2 }],
      vo: null,
    },
    {
      id: "aurora", t0: 200, t1: 230,
      label: "Кадр 8", date: "21:40, 25 октября",
      title: "Выстрел «Авроры»",
      narration: "21 час 40 минут. По сигналу с Петропавловской крепости — холостой выстрел носового орудия «Авроры». Сигнал к штурму. Начинается обстрел дворца с крепости и из-под арки Главного штаба. Защитники деморализованы, один за другим складывают оружие.",
      illustration: "k8_aurora",
      illCaption: "Крейсер «Аврора», 1917",
      focus: ["aurora", "winter"], framing: "tight",
      points: [
        { key: "fortress", force: "vrk", pulse: true },
        { key: "aurora", force: "vrk", onNeva: true },
        { key: "winter", force: "pg", pulse: "fast" },
      ],
      fx: [{ type: "shot", from: "aurora", signalFrom: "fortress", to: "winter", at: 0.42 }],
      vo: null, sfx: "aurora_blank_shot",
    },
    {
      id: "winter_taken", t0: 230, t1: 250,
      label: "Кадр 9", date: "1:50 ночи, 26 октября",
      title: "Зимний взят",
      narration: "26 октября, 1 час 50 минут ночи. Зимний дворец взят. Антонов-Овсеенко входит в Малую столовую. Министры арестованы и отправлены в Петропавловскую крепость. Власть в городе — у Военно-революционного комитета.",
      illustration: "k9_kerensky_office",
      illCaption: "Кабинет Керенского после его бегства, 25 октября 1917",
      quote: "Объявляю вам, всем членам Временного правительства, что вы арестованы. Я представитель Военно-революционного комитета Антонов.",
      cite: "Из воспоминаний министра юстиции П.Н. Малянтовича",
      focus: ["winter"], framing: "tight",
      points: [
        { key: "winter", force: "pg", becomes: "red", at: 0.35 },
        { key: "fortress", force: "vrk" },
      ],
      routes: [{ key: "winter_to_fortress", force: "vrk", at: 0.5, dur: 0.4, note: "арест министров" }],
      fx: [{ type: "flood", from: "winter", at: 0.6 }],
      vo: null,
    },
    {
      id: "finale", t0: 250, t1: 270,
      label: "Финал", date: "Той же ночью",
      title: "Съезд. Новая власть",
      narration: "Той же ночью в Смольном продолжается II Всероссийский съезд Советов. Эсеры и меньшевики покинули зал. Остались большевики и их союзники. Сформировано первое советское правительство — Совет Народных Комиссаров; председателем избран Ленин.",
      illustration: "k9_soldiers",
      illCaption: "Революционные солдаты в Зимнем дворце, 1917",
      quote: "Товарищи! Рабочая и крестьянская революция, о необходимости которой всё время говорили большевики, — совершилась.",
      cite: "В.И. Ленин, 25 октября (7 ноября) 1917 г.",
      focus: ["smolny"], framing: "wide",
      points: [{ key: "smolny", force: "vrk", pulse: true }],
      fx: [{ type: "rays", from: "smolny", at: 0.2 }],
      vo: null,
    },
  ],
};
