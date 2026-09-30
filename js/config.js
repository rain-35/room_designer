// Public settings. The publishable key is designed to be public: it only lets a
// signed-in user reach their own rows (row-level security does the protecting).
// Never put a secret or service_role key in this file.
(function (RP) {
  'use strict';

  RP.config = {
    SUPABASE_URL: 'https://orwlqqcspnvwihlwacoa.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_hUu51CiKhzjG8tGr7GTOgA_Xd7f6EmZ',
    APP_URL: 'https://rain-35.github.io/room_designer/',
    AUTH_STORAGE_KEY: 'rp-auth',
  };
})(window.RP = window.RP || {});
