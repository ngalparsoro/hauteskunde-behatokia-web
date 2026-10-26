/* Tema claro/oscuro · se carga SÍNCRONO en <head>, antes de pintar.
   Solo hace una cosa: si hay elección guardada, ponerla en <html data-theme>. Sin
   elección no toca nada y decide `prefers-color-scheme` desde el CSS (src/tema.css).
   Va aparte de app.js porque app.js es un módulo (diferido): desde ahí el tema
   llegaría después del primer pintado y se vería un fogonazo oscuro.
   Nada de esto es incrustado: la CSP del sitio solo permite scripts propios. */
(function () {
  try {
    var t = localStorage.getItem("tema");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    // el satélite arranca encendido, así que el mapa empieza con la paleta oscura en los dos
    // temas; paletaEzarri() lo corrige si alguien lo apaga (src/06-menu-erradiala.js)
    document.documentElement.setAttribute("data-mapa", "ilun");
  } catch (e) { /* localStorage bloqueado (modo privado): se queda con la del sistema */ }
})();
