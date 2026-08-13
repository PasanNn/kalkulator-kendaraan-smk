# Kalkulator Kendaraan — Cloudflare Pages + D1

Versi ini mengganti login browser/localStorage menjadi login server-side menggunakan **Cloudflare Pages Functions + D1**.

## Struktur

```text
index.html
functions/
  api/
    auth.js
schema.sql
wrangler.toml.example
```

## Cara deploy melalui Cloudflare Dashboard

### 1. Buat database D1

Cloudflare Dashboard → **Workers & Pages → D1 SQL databases → Create database**.

Nama contoh: `kalkulator-kendaraan-db`.

### 2. Buat project Pages

Hubungkan repository GitHub/GitLab yang berisi folder ini, atau upload/deploy project sesuai metode Pages yang Anda pakai.

`functions/` harus berada di root project, sejajar dengan `index.html`.

### 3. Hubungkan D1 ke Pages

Di project Pages, buka **Settings → Functions → Bindings** (nama menu dapat berubah sesuai UI Cloudflare), lalu tambahkan D1 database:

- Variable name / binding: `DB`
- Database: `kalkulator-kendaraan-db`

Binding Pages Functions memang mendukung D1. Pastikan nama binding **persis `DB`** karena fungsi menggunakan `env.DB`.

### 4. Database

Anda dapat mengimpor `schema.sql` ke D1, atau cukup deploy saja karena `functions/api/auth.js` membuat tabel yang diperlukan otomatis saat dipanggil.

### 5. Buka website

Saat halaman dibuka pertama kali, API akan membuat akun awal jika tabel masih kosong:

- Username: `admin`
- Password: `admin123`

Setelah login, buka **Kelola Akun** dan ganti password.

## Catatan penting

- Jangan taruh password database/API secret di HTML. Versi ini tidak membutuhkannya.
- Session disimpan sebagai token pada cookie `HttpOnly + Secure + SameSite=Lax` dan token di database disimpan dalam bentuk hash.
- Password akun diproses dengan PBKDF2-SHA-256 sebelum disimpan.
- Akun terpusat di D1, jadi login yang sama bisa digunakan dari HP/laptop/browser berbeda.
- Kalkulator yang sudah ada tetap berada di `index.html`; yang diganti hanya lapisan autentikasinya.

## Jika Anda pakai GitHub

Upload isi folder ini ke repository dan jadikan repository tersebut sebagai source Cloudflare Pages.

Jangan mengubah nama:
- `index.html`
- `functions/api/auth.js`
- binding `DB`

Karena semuanya sudah saling terhubung.
