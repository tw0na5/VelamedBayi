-- Bayi Sorumluluk Haritası: Supabase SQL Editor'de bir kez çalıştırın.

create table if not exists public.iller (
  il          text primary key,
  sorumlu     text check (sorumlu in ('Yıldırım','Tuna','Hakan')),
  bayi        text,
  yetkili     text,
  tel         text,
  adres       text,
  notlar      text,
  isler       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

-- Her değişiklikte zaman ve kişi bilgisini güncelle
create or replace function public.iller_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists iller_touch on public.iller;
create trigger iller_touch before insert or update on public.iller
for each row execute function public.iller_touch();

-- Güvenlik: sadece giriş yapmış kullanıcılar okuyup yazabilir
alter table public.iller enable row level security;

drop policy if exists "giris yapan okur" on public.iller;
create policy "giris yapan okur" on public.iller
  for select to authenticated using (true);

drop policy if exists "giris yapan ekler" on public.iller;
create policy "giris yapan ekler" on public.iller
  for insert to authenticated with check (true);

drop policy if exists "giris yapan gunceller" on public.iller;
create policy "giris yapan gunceller" on public.iller
  for update to authenticated using (true) with check (true);

-- Canlı güncelleme (Realtime) için tabloyu yayına ekle
alter publication supabase_realtime add table public.iller;
