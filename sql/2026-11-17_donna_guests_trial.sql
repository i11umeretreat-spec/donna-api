-- Три пробные ночи «Фонарщика», 17.11.2026. Спека: donna_spec_fonarshchik.md, часть Б.
-- Применить ДО деплоя verify-token: он читает expires_at, и без колонки
-- гостевая ветка вернула бы «ключ неверен» всем гостям.
-- Обе колонки nullable: старый лид-магнит (water_energy) остаётся бессрочным.
alter table public.donna_guests add column if not exists expires_at timestamptz null;
alter table public.donna_guests add column if not exists campaign text null;
-- Таблица создана не миграцией, права у service_role уже есть; перезагружаем схему PostgREST.
notify pgrst, 'reload schema';
