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

-- İzin listesi: sadece bu listedeki kullanıcılar verileri görüp değiştirebilir.
-- Dışarıdan açılan hesaplar hiçbir şey göremez.
create table public.izinli_kullanicilar (
  user_id uuid primary key references auth.users(id) on delete cascade,
  eklenme timestamptz not null default now()
);
alter table public.izinli_kullanicilar enable row level security;

create schema if not exists private;
grant usage on schema private to authenticated;
create function private.izinli_mi() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.izinli_kullanicilar where user_id = (select auth.uid()));
$$;
revoke execute on function private.izinli_mi() from public, anon;
grant execute on function private.izinli_mi() to authenticated;

alter policy "giris yapan okur" on public.iller using ((select private.izinli_mi()));
alter policy "giris yapan ekler" on public.iller with check ((select private.izinli_mi()));
alter policy "giris yapan gunceller" on public.iller using ((select private.izinli_mi())) with check ((select private.izinli_mi()));

-- Yeni kullanıcıyı Authentication > Users'tan ekledikten sonra izin verin:
-- insert into public.izinli_kullanicilar (user_id)
-- select id from auth.users where email = 'kullaniciadi@bayi.local';

-- Referans koduyla kayıt. Kod veritabanında şifrelenmiş (hash) tutulur; tarayıcıya hiç gönderilmez.
create table private.ayarlar (anahtar text primary key, deger text not null);
revoke all on private.ayarlar from public, anon, authenticated;
-- Kodu belirlemek/değiştirmek için (KODUNUZ yerine yeni kodu yazın):
-- insert into private.ayarlar values ('referans_hash', extensions.crypt('KODUNUZ', extensions.gen_salt('bf')))
--   on conflict (anahtar) do update set deger = excluded.deger;
-- public.kayit_ol(kullanici, sifre, referans) fonksiyonu: kodu kontrol eder, kullanıcıyı açar ve izin listesine ekler.
