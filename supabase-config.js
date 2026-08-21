/* =========================================================================
   ARCHIVO GENERADO — NO LO EDITES A MANO.

   Se genera con `npm run config` a partir de las variables del .env.
   Si tenés que cambiar la URL o la clave, editá el .env y volvé a correrlo.

   La clave anon/publishable es pública por diseño: queda visible en el
   código del sitio y está bien. La seguridad real la dan las políticas RLS
   de la tabla. Ver SUPABASE.md.
   ========================================================================= */

(function () {
  "use strict";

  var SUPABASE_URL = "https://aiytevmxalwwbxxbgtwe.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_Wuk9GT_or3CxmVx6v5R6Bg_YOdPeY4Q";

  // El build UMD del CDN expone el namespace global `supabase`. Por eso el
  // cliente se guarda en `db`: si lo llamáramos `supabase` pisaríamos el
  // namespace y el próximo createClient() rompería.
  if (typeof supabase === "undefined" || typeof supabase.createClient !== "function") {
    console.error(
      "[supabase] El SDK no está cargado. En index.html el <script> del CDN " +
        "tiene que ir ANTES de supabase-config.js."
    );
    return;
  }

  window.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
