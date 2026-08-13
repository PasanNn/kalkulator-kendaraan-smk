# Kalkulator Kendaraan — Cloudflare Worker + D1

Versi ini cocok untuk **Cloudflare Workers + Static Assets + D1**. Login dan akun tidak disimpan di browser; data akun ada di D1 dan session menggunakan cookie HttpOnly.

## Struktur

- `worker.js` — API login/logout/kelola akun dan router static assets.
- `public/index.html` — aplikasi kalkulator Anda.
- `wrangler.jsonc` — konfigurasi Worker + static assets + D1 binding.
- `schema.sql` — tabel akun/session jika ingin dibuat manual dari D1 SQL editor.

## 1. Isi Database ID

Buka `wrangler.jsonc` dan ganti:

`PASTE_DATABASE_ID_D1_ANDA_DI_SINI`

menjadi **Database ID** dari database D1 `kalkulator-kendaraan-db` Anda.

Cloudflare mendokumentasikan D1 binding dengan `binding`, `database_name`, dan `database_id`; binding `DB` akan tersedia di Worker sebagai `env.DB`. citehttps://developers.cloudflare.com/d1/get-started/

## 2. GitHub

Upload/replace seluruh isi repository dengan file di folder ini. Struktur root harus:

```
worker.js
wrangler.jsonc
schema.sql
public/
  index.html
```

## 3. Hubungkan Worker ke GitHub

Di Cloudflare: **Workers & Pages → pilih Worker → Settings → Builds → Connect**.
Pilih GitHub dan repository `kalkulator-kendaraan-smk`.
Cloudflare Workers Builds akan menjalankan deploy setiap ada push ke branch yang terhubung. citehttps://developers.cloudflare.com/workers/ci-cd/builds/

## 4. Build settings

Build command: kosong.
Deploy command: `npx wrangler deploy`.
Root directory: `/`.

Cloudflare Workers Builds menggunakan deploy command `npx wrangler deploy` secara default bila tidak diubah. citehttps://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## 5. Login awal

Ketika aplikasi pertama kali dibuka dan database masih kosong, Worker otomatis membuat:

- Username: `admin`
- Password: `admin123`

Segera ubah password melalui **Kelola Akun**.

## Catatan penting

Jangan commit API token, password Cloudflare, atau password database ke GitHub. Database ID sendiri bukan password/credential rahasia.
