/* МТК №24 — обрезка рабочего экрана по ТОЧНОЙ форме из ТЗ (in/размер 24.PNG):
 * трапеция с ГЛАДКИМИ дугами сверху/снизу. clip-path: path() строится в px и
 * пересчитывается при любом изменении размера #work (ResizeObserver), поэтому
 * дуги настоящие (не ломаная) и масштабируются. Вынесено отдельно от scene.js.
 *
 * Параметры формы (доли bbox) — из tools/extract_shape.py.
 */
(function () {
  // углы + контрольные точки квадратичных дуг (верх/низ), доли bbox
  var S = {
    tl: [0.0058, 0.0201], tr: [0.9942, 0.0201],
    br: [0.9432, 0.9933], bl: [0.0611, 0.9950],
    topC: [0.5000, -0.0201],   // контроль верхней дуги (≈2% прогиб вверх)
    botC: [0.5022, 0.9691],    // контроль нижней дуги (≈1.3% прогиб вверх)
  };
  function P(p, w, h) { return (p[0] * w).toFixed(1) + " " + (p[1] * h).toFixed(1); }
  function apply() {
    var el = document.getElementById("work");
    if (!el) return;
    var w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    var d = 'path("M ' + P(S.tl, w, h) +
            ' Q ' + P(S.topC, w, h) + " " + P(S.tr, w, h) +
            ' L ' + P(S.br, w, h) +
            ' Q ' + P(S.botC, w, h) + " " + P(S.bl, w, h) + ' Z")';
    el.style.clipPath = d;
    el.style.webkitClipPath = d;
  }
  function start() {
    var el = document.getElementById("work");
    if (!el) { requestAnimationFrame(start); return; }
    if (window.ResizeObserver) new ResizeObserver(apply).observe(el);
    window.addEventListener("resize", function () { requestAnimationFrame(apply); });
    apply();
  }
  start();
})();
