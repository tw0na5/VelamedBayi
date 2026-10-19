# Bayi Sorumluluk Haritası – Kurulum

Klasördeki dosyalar:
- `index.html` – uygulama
- `config.js` – Supabase bağlantı bilgileri (siz dolduracaksınız)
- `supabase.sql` – veritabanı tablosu ve güvenlik kuralları

## 1. Supabase

1. Supabase'de yeni bir proje açın (ya da mevcut bir projeyi kullanın).
2. **SQL Editor** → `supabase.sql` dosyasının içeriğini yapıştırın → **Run**.
3. **Authentication → Sign In / Providers**:
   - **Allow new users to sign up** seçeneğini **KAPATIN**. Böylece kimse kendi kendine hesap açamaz.
   - Email sağlayıcısında **Confirm email** seçeneğini kapatın.
4. **Project Settings → API**: `Project URL` ve `anon public` anahtarını `config.js` içine yazın.

## 2. Kullanıcı ekleme (sadece siz)

**Authentication → Users → Add user → Create new user**

- Email: `kullaniciadi@bayi.local` (örnek: `yildirim@bayi.local`)
- Password: kullanıcıya vereceğiniz şifre
- **Auto Confirm User** işaretli olsun

Kullanıcı uygulamada sadece `yildirim` yazıp şifresiyle giriş yapar. `@bayi.local` gerçek bir e-posta değildir, sadece kullanıcı adı olarak kullanılır.

- Şifre değiştirmek: kullanıcının yanındaki **…** menüsü
- Erişimi kaldırmak: kullanıcıyı silin

## 3. Vercel

1. Klasörü GitHub'a yükleyin ve Vercel'de **Add New → Project** ile içe aktarın.
   - Framework: **Other**. Build ayarı gerekmez.
2. Ya da Vercel CLI ile klasörün içinden `vercel --prod` çalıştırın.

## Notlar

- Haritayı görmek de giriş gerektirir. Bilgiler giriş yapmayan kimseye gösterilmez.
- Giriş yapan herkes tüm illeri düzenleyebilir. Değişiklikler diğer açık ekranlara birkaç saniye içinde yansır.
- Her kayıtta son değişikliği kimin ve ne zaman yaptığı (`updated_by`, `updated_at`) veritabanında tutulur.
