# Günce

Uygulama çocuklar (9–14) ve velileri için: gününü anlat, haftanı birlikte düzenle.

**Kilometre taşı 1:** hesaplar, yetkilendirme, onboarding, eşleştirme.  
**Kilometre taşı 2:** metin günlüğü ve çocuğun kontrolünde veli paylaşımı (yapay zekâ / ses / plan yok).

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

Testler yalnızca `gunce_test` kullanır.

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

Yeni günlük migrasyonu: `20260909155123_journal_sharing` ( `migrate deploy` ile uygulanır ).

```bash
npm run typecheck
npm run build
npm test
npm run build && npm run test:e2e   # Playwright; Chromium gerekir
```

## Manuel deneme (ayrı oturumlar)

1. Veli kaydı → çocuk profili → davet kodu.
2. Ayrı profil/cihazda çocuk eşleştirmesi ve onboarding.
3. Çocuk: **Günümü anlat** → yaz → **Kaydet (bende kalsın)** → **Paylaşımı hazırla** → veli mesajı ve/veya destek isteği → **Paylaş**.
4. Veli ana ekranında yalnızca paylaşılan metni gör; özel günlük görünmez.
5. Çocuk: **Paylaşımı geri çek** → veli yenileyince içerik kaybolur.

## Bilinen sınırlamalar

- Yapay zekâ özeti, ses, haftalık plan, hedefler, bildirimler **yok**.
- E-posta doğrulama ve şifre sıfırlama **yok**.
- Rate limit uygulama/DB düzeyinde; üretimde ek kenar koruması önerilir.
