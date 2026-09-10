# Günce

Uygulama çocuklar (9–14) ve velileri için: gününü anlat, haftanı birlikte düzenle.

**Kilometre taşı 1:** hesaplar, yetkilendirme, onboarding, eşleştirme.  
**Kilometre taşı 2:** metin günlüğü ve çocuğun kontrolünde veli paylaşımı.  
**Kilometre taşı 3:** sesle anlatım (yazıya çevirme) ve çocuğun gözden geçirdiği yapay zekâ özeti.

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
| `OPENAI_API_KEY` | (İsteğe bağlı) Ses yazıya çevirme ve özet; yoksa günlük yazma çalışır, ses/özet “kullanılamıyor” olur |
| `OPENAI_TRANSCRIBE_MODEL` | Varsayılan: `gpt-transcribe` |
| `OPENAI_SUMMARY_MODEL` | Varsayılan: `gpt-4o-mini` |
| `GUNCE_AI_TEST_MODE` | Yalnızca otomatik testler; gerçek uygulamada / üretimde kullanma |
| `GUNCE_ALLOW_AI_TEST_STUBS` | `NODE_ENV=production` iken stub için ek anahtar (yalnızca Playwright); üretim host’una koyma |

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

```bash
npm run typecheck
npm run build
npm test
npm run build && npm run test:e2e   # Playwright; Chromium gerekir; GUNCE_AI_TEST_MODE stub’ları kullanır
```

## Manuel deneme (ayrı oturumlar)

1. Veli kaydı → çocuk profili → davet kodu.
2. Ayrı profil/cihazda çocuk eşleştirmesi ve onboarding.
3. Çocuk: **Günümü anlat** → konu seç → yaz (veya mikrofon; `OPENAI_API_KEY` gerekir). Uzun anlatımda her bölüm ~120 sn; uyarıdan sonra **Devam et** / **Bitirdim**. Çözümü gözden geçir → **Yazımı toparla** → öneriyi düzenle/kabul et → **Kaydet (bende kalsın)**.
4. İstersen **Paylaşımı hazırla** → **Özetimden kopyala** → önizle → **Paylaş** (otomatik paylaşılmaz).
5. Veli ana ekranında yalnızca yayınlanan anlık görüntüyü gör; özel metin / transkript / öneri görünmez.
6. **Paylaşımı geri çek** → velinin uygulamada görmesi durur; daha önce okunan bilgi geri alınamaz.

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

- Haftalık plan, hedefler, bildirimler, duygu skoru, genel sohbet botu **yok**.
- E-posta doğrulama ve şifre sıfırlama **yok**.
- Canlı OpenAI çağrıları anahtar olmadan doğrulanmaz; testler deterministik stub kullanır.
- Çok bölümlü seste işlenmemiş ses yalnızca bellektemedir; yenileme / sekme kapatma / çökmede kaybolur.
- Anlatım oturumu en fazla 12 bölüm (bölüm başı ~120 sn); görünmez arka plan dilimleme yok.
- Rate limit uygulama/DB düzeyinde; üretimde ek kenar koruması önerilir.
