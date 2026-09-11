# Günce

Uygulama çocuklar (9–14) ve velileri için: gününü anlat, haftanı birlikte düzenle.

**Kilometre taşı 1:** hesaplar, yetkilendirme, onboarding, eşleştirme.  
**Kilometre taşı 2:** metin günlüğü ve çocuğun kontrolünde veli paylaşımı.  
**Kilometre taşı 3:** sesle anlatım (yazıya çevirme) ve çocuğun gözden geçirdiği yapay zekâ özeti.  
**Kilometre taşı 4:** çocuğun yönettiği haftalık plan ve pano; velinin salt okunur görünümü.  
**Kilometre taşı 5:** uzun vadeli hedefler; aynı çalışma adımlarıyla bağlantı; veli salt okunur.  
**Kilometre taşı 6:** günlükten plan önerileri; çocuk seçer ve mevcut plana ekler.  
**Kilometre taşı 7:** isteğe bağlı hatırlatmalar; sunucu zamanlaması ve Web Push.

Ürün: [`docs/product.md`](docs/product.md) · Mimari: [`docs/architecture.md`](docs/architecture.md)

## Gereksinimler

- Node.js 20+
- PostgreSQL 15+ (önerilen: Homebrew `postgresql@15`)

## Ortam değişkenleri

```bash
cp .env.example .env
```

| Değişken | Açıklama |
|----------|----------|
| `DATABASE_URL` | Geliştirme veritabanı (`gunce`) |
| `BETTER_AUTH_SECRET` | Uzun rastgele gizli anahtar (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Uygulama kök URL’si (`http://localhost:3000`) |
| `NEXT_PUBLIC_APP_URL` | İstemci tabanlı URL (`http://localhost:3000`) |
| `OPENAI_API_KEY` | (İsteğe bağlı) Ses yazıya çevirme, özet ve plan önerisi; yoksa günlük/plan elle çalışır |
| `OPENAI_TRANSCRIBE_MODEL` | Varsayılan: `gpt-transcribe` |
| `OPENAI_SUMMARY_MODEL` | Varsayılan: `gpt-4o-mini` |
| `OPENAI_PLAN_EXTRACT_MODEL` | Varsayılan: `OPENAI_SUMMARY_MODEL` veya `gpt-4o-mini` |
| `GUNCE_AI_TEST_MODE` | Yalnızca otomatik testler; gerçek uygulamada / üretimde kullanma |
| `GUNCE_ALLOW_AI_TEST_STUBS` | `NODE_ENV=production` iken stub için ek anahtar (yalnızca Playwright); üretim host’una koyma |
| `LIVE_PLAN_EXTRACT` | `1` iken canlı plan-çıkarım kalite testi; CI’da varsayılan kapalı |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push VAPID genel anahtar |
| `VAPID_PRIVATE_KEY` | Web Push VAPID özel anahtar (yalnızca sunucu) |
| `VAPID_SUBJECT` | `mailto:` veya site URL (VAPID subject) |
| `REMINDER_SCHEDULER_SECRET` | Dahili zamanlayıcı endpoint sırrı |

Testler yalnızca `gunce_test` kullanır.

**Geliştirme notu:** Veli kaydında e-posta doğrulanmış sayılmaz (`emailVerified=false`). Yerel giriş doğrulama olmadan çalışır; tam doğrulama akışı bu kilometre taşında yok.

## PostgreSQL (Homebrew — önerilen)

```bash
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
mkdir -p .pg-log
pg_ctl -D /opt/homebrew/var/postgresql@15 -l .pg-log/postgres.log start

createuser -s gunce 2>/dev/null || true
psql -d postgres -c "ALTER USER gunce WITH PASSWORD 'gunce' LOGIN;"
createdb -O gunce gunce 2>/dev/null || true
createdb -O gunce gunce_test 2>/dev/null || true
```

```text
DATABASE_URL="postgresql://gunce:gunce@localhost:5432/gunce?schema=public"
```

### Docker (isteğe bağlı)

```bash
docker compose up -d
```

## Kurulum, migrasyon, çalıştırma

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Ses/özet migrasyonu: `20260909180000_voice_summary`.  
Haftalık plan migrasyonu: `20260910180000_weekly_planning`.  
Çalışma adımı durumu (pano): `20260910190000_study_step_status`.  
Tamamlanma zaman damgası (metadata): `20260910200000_study_step_completed_at_metadata`.  
Uzun vadeli hedefler: `20260910210000_plan_goals`.  
Günlükten plan önerileri: `20260910220000_plan_extract`.  
Hatırlatmalar / Web Push: `20260911100000_reminders_web_push`.

```bash
npm run typecheck
npm run build
npm test
npm run reminders:process          # yerel zamanlayıcı (VAPID + DB gerekir)
npm run build && npm run test:e2e  # Playwright; Chromium gerekir
```

### Hatırlatmalar (Milestone 7)

1. VAPID üret: `npx web-push generate-vapid-keys` → `.env` içine yaz (gerçek anahtarları repoya koyma).
2. `REMINDER_SCHEDULER_SECRET` ayarla (en az 16 karakter).
3. Çocuk: **Hatırlatmalar** → tercihleri aç → **Bu cihazda bildirimleri aç** (HTTPS veya localhost).
4. **Deneme bildirimi gönder** (kabul ≠ ekranda görünme garantisi).
5. Yerel işleyici: `npm run reminders:process` veya harici cron → `POST /api/internal/reminders/process` + Bearer secret.
6. Gelecek barındırma: periyodik scheduler (1–5 dk), HTTPS, VAPID, secret; hosting bu kilometre taşında provision edilmez.

**Manuel gerçek cihaz (HTTPS) kontrol listesi:** aç → deneme bildirimi → uygulamayı kapat → zamanlanmış hatırlatmayı tetikle → adımı tamamla/ertele → eski hatırlatmanın gelmediğini doğrula → oturumu iptal et → yeni gönderim olmasın. Localhost bunu kanıtlamaz.

## Manuel deneme (ayrı oturumlar)

1. Veli kaydı → çocuk profili → davet kodu.
2. Ayrı profil/cihazda çocuk eşleştirmesi ve onboarding.
3. Çocuk: **Günümü anlat** → konu seç → yaz (veya mikrofon; `OPENAI_API_KEY` gerekir). Uzun anlatımda her bölüm ~120 sn; uyarıdan sonra **Devam et** / **Bitirdim**. Çözümü gözden geçir → **Yazımı toparla** → öneriyi düzenle/kabul et → **Kaydet (bende kalsın)**.
4. İstersen **Paylaşımı hazırla** → **Özetimden kopyala** → önizle → **Paylaş** (otomatik paylaşılmaz).
5. Veli ana ekranında yalnızca yayınlanan anlık görüntüyü gör; özel metin / transkript / öneri görünmez.
6. **Paylaşımı geri çek** → velinin uygulamada görmesi durur; daha önce okunan bilgi geri alınamaz.
7. Çocuk: **Plan ekle** → örn. Cuma “Almanca kelime sınavı” → Çarşamba/Perşembe hazırlık adımları → **Tamamladım** / **Başka güne taşı**. Sınav tarihi değişmez.
8. **Haftam** içinde **Hafta** / **Pano** görünümleri; panoda **Başla** → **Tamamladım**. Aynı adımlar her iki görünümde.
9. Veli: **Haftanın planı** salt okunur (durum etiketleriyle); planı düzenleyemez. Plan API’leri günlük metni taşımaz.
10. Çocuk: **Hedeflerim** → hedef + adımlar; panoda tamamla → ilerleme güncellenir. Veli **Hedefler** salt okunur.

### Mikrofon (manuel kontrol listesi)

- Açıklama, izin istemeden önce görünür mü?
- Yalnızca açık eylemle kayıt başlıyor mu? Durdur / bu bölümü iptal / **Devam et** / **Bitirdim**?
- Bölüm sonu uyarısı (“Bu bölüm birazdan bitecek…”) ve otomatik yeniden başlatma **yok** mu?
- Başarısız bölüm: yeniden dene / atla; tamamlananlar korunuyor mu?
- İşlenmemiş ses sayfa yenilemede kaybolur (bilinçli sınır); kaydedilmiş yazı durur mu?
- Transkript sessizce üzerine yazmıyor; ekle / yerine koy açık mı?

Gerçek iPhone Safari / Android mikrofon uyumu yalnızca gerçek cihazda doğrulanır; Playwright simülasyonu bunun yerine geçmez.

## Sağlayıcı verisi

Ses ve metin, yapılandırılmış OpenAI uç noktalarına gönderilir. Uygulama ses dosyasını saklamaz. Sağlayıcının veriyi ne kadar tuttuğu OpenAI politikasına bağlıdır; bu depoda “saklamaz” iddiası yoktur.

## Bilinen sınırlamalar

- Uzun vadeli hedefler, bildirimler, tekrarlayan programlar, yapay zekâ ile otomatik görev çıkarma **yok**.
- E-posta doğrulama ve şifre sıfırlama **yok**.
- Canlı OpenAI çağrıları anahtar olmadan doğrulanmaz; testler deterministik stub kullanır.
- Çok bölümlü seste işlenmemiş ses yalnızca bellektemedir; yenileme / sekme kapatma / çökmede kaybolur.
- Anlatım oturumu en fazla 12 bölüm (bölüm başı ~120 sn); görünmez arka plan dilimleme yok.
- Plan tahmini dakikaları planlanan çabadır; ölçülen çalışma süresi veya ustalık çıkarımı yok.
- Rate limit uygulama/DB düzeyinde; üretimde ek kenar koruması önerilir.
