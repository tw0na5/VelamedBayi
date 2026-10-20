-- Velamed: roller, kart ataması, yorum/geçmiş, dosya ekleri.
-- Supabase > SQL Editor'de bir kez çalıştırın.

-- 1) Kullanıcı adları ve roller
alter table public.izinli_kullanicilar
  add column kullanici_adi text,
  add column rol text not null default 'duzenleyici' check (rol in ('yonetici','duzenleyici','kendi','izleyici')),
  add column sorumlu_adi text check (sorumlu_adi in ('Yıldırım','Tuna','Hakan'));
update public.izinli_kullanicilar i set kullanici_adi = split_part(u.email,'@',1) from auth.users u where u.id = i.user_id;
update public.izinli_kullanicilar set sorumlu_adi = case kullanici_adi when 'tuna' then 'Tuna' when 'yildirim' then 'Yıldırım' when 'hakan' then 'Hakan' end;
update public.izinli_kullanicilar set rol = 'yonetici' where kullanici_adi = 'tuna';

create policy "izinli okur" on public.izinli_kullanicilar for select to authenticated using ((select private.izinli_mi()));

create function private.benim_rol() returns text
language sql stable security definer set search_path = '' as $$
  select rol from public.izinli_kullanicilar where user_id = (select auth.uid());
$$;
create function private.benim_sorumlu() returns text
language sql stable security definer set search_path = '' as $$
  select sorumlu_adi from public.izinli_kullanicilar where user_id = (select auth.uid());
$$;
create function private.il_duzenleyebilir(p_il text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.benim_rol()
    when 'yonetici' then true
    when 'duzenleyici' then true
    when 'kendi' then exists (select 1 from public.iller where il = p_il and sorumlu = private.benim_sorumlu())
    else false end;
$$;
revoke execute on function private.benim_rol(), private.benim_sorumlu(), private.il_duzenleyebilir(text) from public, anon;
grant execute on function private.benim_rol(), private.benim_sorumlu(), private.il_duzenleyebilir(text) to authenticated;

create policy "yonetici gunceller" on public.izinli_kullanicilar for update to authenticated
  using ((select private.benim_rol()) = 'yonetici') with check ((select private.benim_rol()) = 'yonetici');

alter policy "giris yapan ekler" on public.iller with check (
  (select private.benim_rol()) in ('yonetici','duzenleyici')
  or ((select private.benim_rol()) = 'kendi' and sorumlu = (select private.benim_sorumlu())));
alter policy "giris yapan gunceller" on public.iller
  using ((select private.benim_rol()) in ('yonetici','duzenleyici')
    or ((select private.benim_rol()) = 'kendi' and sorumlu = (select private.benim_sorumlu())))
  with check ((select private.benim_rol()) in ('yonetici','duzenleyici')
    or ((select private.benim_rol()) = 'kendi' and sorumlu = (select private.benim_sorumlu())));

-- 2) Kartlar: atanan kişi ve tamamlanma zamanı
alter table public.isler
  add column atanan uuid references public.izinli_kullanicilar(user_id) on delete set null,
  add column tamamlanma timestamptz;
update public.isler set tamamlanma = coalesce(tarih::timestamptz, created_at) where durum = 'tamam';

create or replace function public.isler_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if new.durum = 'tamam' then
    if tg_op = 'INSERT' or old.durum is distinct from 'tamam' then new.tamamlanma := coalesce(new.tamamlanma, now()); end if;
  else
    new.tamamlanma := null;
  end if;
  return new;
end $$;
create or replace trigger isler_touch before insert or update on public.isler
for each row execute function public.isler_touch();

alter policy "izinli ekler" on public.isler with check ((select private.il_duzenleyebilir(il)));
alter policy "izinli gunceller" on public.isler using ((select private.il_duzenleyebilir(il))) with check ((select private.il_duzenleyebilir(il)));
alter policy "izinli siler" on public.isler using ((select private.il_duzenleyebilir(il)));

-- 3) Yorumlar ve kart geçmişi
create table public.kart_olaylari (
  id uuid primary key default gen_random_uuid(),
  kart_id uuid not null references public.isler(id) on delete cascade,
  tur text not null check (tur in ('yorum','olay')),
  metin text not null check (length(trim(metin)) > 0),
  yazan uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index kart_olaylari_kart_idx on public.kart_olaylari (kart_id);
alter table public.kart_olaylari enable row level security;
create policy "izinli okur" on public.kart_olaylari for select to authenticated using ((select private.izinli_mi()));
create policy "yorum yazar" on public.kart_olaylari for insert to authenticated
  with check (tur = 'yorum' and yazan = (select auth.uid()) and (select private.benim_rol()) in ('yonetici','duzenleyici','kendi'));
create policy "kendi yorumunu siler" on public.kart_olaylari for delete to authenticated
  using (tur = 'yorum' and (yazan = (select auth.uid()) or (select private.benim_rol()) = 'yonetici'));

create function private.isler_olay() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d_old text; d_new text; a_old text; a_new text;
begin
  if tg_op = 'INSERT' then
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay', 'Kartı oluşturdu', auth.uid());
    return new;
  end if;
  if new.durum is distinct from old.durum then
    d_old := case old.durum when 'yapilacak' then 'Yapılacak' when 'devam' then 'Devam ediyor' else 'Tamamlandı' end;
    d_new := case new.durum when 'yapilacak' then 'Yapılacak' when 'devam' then 'Devam ediyor' else 'Tamamlandı' end;
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay', 'Durumu değiştirdi: ' || d_old || ' → ' || d_new, auth.uid());
  end if;
  if new.atanan is distinct from old.atanan then
    select kullanici_adi into a_new from public.izinli_kullanicilar where user_id = new.atanan;
    select kullanici_adi into a_old from public.izinli_kullanicilar where user_id = old.atanan;
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay',
      case when new.atanan is null then 'Atamayı kaldırdı' else 'Atadı: ' || coalesce(a_new, '?') end, auth.uid());
  end if;
  if new.tarih is distinct from old.tarih then
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay',
      case when new.tarih is null then 'Tarihi kaldırdı' else 'Tarihi değiştirdi: ' || to_char(new.tarih, 'DD.MM.YYYY') end, auth.uid());
  end if;
  if new.il is distinct from old.il then
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay', 'İli değiştirdi: ' || old.il || ' → ' || new.il, auth.uid());
  end if;
  if new.baslik is distinct from old.baslik then
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay', 'Başlığı değiştirdi', auth.uid());
  end if;
  if new.aciklama is distinct from old.aciklama then
    insert into public.kart_olaylari (kart_id, tur, metin, yazan) values (new.id, 'olay', 'Açıklamayı güncelledi', auth.uid());
  end if;
  return new;
end $$;
create trigger isler_olay after insert or update on public.isler
for each row execute function private.isler_olay();

-- 4) Dosya ekleri
create table public.ekler (
  id uuid primary key default gen_random_uuid(),
  kart_id uuid not null references public.isler(id) on delete cascade,
  yol text not null unique,
  ad text not null,
  boyut bigint,
  tur text,
  yukleyen uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index ekler_kart_idx on public.ekler (kart_id);
alter table public.ekler enable row level security;
create policy "izinli okur" on public.ekler for select to authenticated using ((select private.izinli_mi()));
create policy "duzenleyen ekler" on public.ekler for insert to authenticated
  with check ((select private.il_duzenleyebilir((select i.il from public.isler i where i.id = kart_id))));
create policy "duzenleyen siler" on public.ekler for delete to authenticated
  using ((select private.il_duzenleyebilir((select i.il from public.isler i where i.id = kart_id))));

insert into storage.buckets (id, name, public, file_size_limit)
values ('ekler', 'ekler', false, 20971520)
on conflict (id) do nothing;
create policy "ekler okuma" on storage.objects for select to authenticated
  using (bucket_id = 'ekler' and (select private.izinli_mi()));
create policy "ekler yukleme" on storage.objects for insert to authenticated
  with check (bucket_id = 'ekler' and (select private.benim_rol()) in ('yonetici','duzenleyici','kendi'));
create policy "ekler silme" on storage.objects for delete to authenticated
  using (bucket_id = 'ekler' and (select private.benim_rol()) in ('yonetici','duzenleyici','kendi'));

alter publication supabase_realtime add table public.kart_olaylari, public.ekler, public.izinli_kullanicilar;

-- 5) Kayıt: kullanıcı adını da sakla
create or replace function public.kayit_ol(kullanici text, sifre text, referans text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  k text := lower(trim(kullanici));
  e text;
  uid uuid := gen_random_uuid();
  h text;
begin
  select deger into h from private.ayarlar where anahtar = 'referans_hash';
  if referans is null or h is null or extensions.crypt(referans, h) <> h then
    raise exception 'Referans kodu hatalı.' using errcode = 'P0001';
  end if;
  if k !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Kullanıcı adı 3-30 karakter olmalı; sadece harf, rakam, nokta, tire ve alt çizgi kullanılabilir.' using errcode = 'P0001';
  end if;
  if sifre is null or length(sifre) < 6 then
    raise exception 'Şifre en az 6 karakter olmalı.' using errcode = 'P0001';
  end if;
  e := k || '@bayi.local';
  if exists (select 1 from auth.users where email = e) then
    raise exception 'Bu kullanıcı adı alınmış.' using errcode = 'P0001';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
    extensions.crypt(sifre, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('kayit','referans'), now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());
  insert into public.izinli_kullanicilar (user_id, kullanici_adi, rol) values (uid, k, 'duzenleyici');
  return k;
end $$;
