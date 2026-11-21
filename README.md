# ETryRoom

ETryRoom is a virtual fitting room for trying clothing from product photos and checking size guidance against a saved body profile. It combines a browser based camera preview, an interactive 3D garment studio, a personal wardrobe, fit comparisons, and a Chrome/Edge product image importer.

## What it does

- **Photo try-on:** upload a product photo. A clothing segmentation model runs in the browser and separates the upper garment, trousers, shoes, and outfit where those parts are visible. The original upload is kept so the lower pieces are not lost when the upper garment is selected.
- **Live camera preview:** pose landmarks align the garment to the shoulders, elbows, hips, and legs. Person segmentation clips the preview to the person. Camera frames and segmentation inference stay on the device.
- **3D studio:** inspect a garment on an adjustable mannequin and rotate the view.
- **Wardrobe and saved looks:** keep uploaded products and looks in the browser, with optional signed-in storage on the server.
- **Size guidance:** compare tape-measured chest, waist, and hip measurements with seller-entered size charts. Each recommendation shows the measurements and ease/range comparisons behind it.
- **Shopping importer:** import a product image and attempt to read a visible size chart from its product page using the unpacked browser extension.

The camera and 3D views are visual previews. They do not reconstruct a retailer's exact garment pattern, calculate a guaranteed fit, or simulate cloth physics. Sizing depends on the accuracy of the measurements and size chart provided.

## Run locally

Requirements: Python 3.11 or newer and Node.js LTS.

On Windows, run `Start ETryRoom.bat`. Or from PowerShell in the project folder:

```powershell
npm ci
npm run build
python -m pip install -r requirements-mvp.txt
python app.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). For front-end development with Vite, run `npm run dev`; the API server still needs to be running for account and catalog features.

The build copies the MediaPipe pose assets, ONNX Runtime Web files, and the clothing parser model into `static/dist`. Keep these model files in place when building or packaging the application. The first camera use asks the browser for camera access; use `localhost` or HTTPS, allow camera permission, and keep the person and clothing area visible in the frame.

## Try-on workflow

1. Add a product image in the fitting desk or import one with the browser extension.
2. Check the extracted upper garment and any detected trousers or shoes. The segmentation is a best-effort result; use a clear product image with the complete clothing item against a contrasting background for the cleanest extraction.
3. Open the camera preview and allow camera access. Face the camera with shoulders and hips in view for the initial alignment. Use the on-screen fit/position controls when the camera angle or pose changes.
4. Create a fit profile using a tape measure, enter the garment's size chart, and review the explanation before choosing a size.

## Shopping extension

In Chrome or Edge, open the Extensions page, enable **Developer mode**, choose **Load unpacked**, and select `etry_extension`. On a product page, right-click a PNG, JPG, or WebP image and select **Try item + detect size chart in ETryRoom**. The extension imports the image and page title and attempts to read a visible size table. Review every detected chart value before saving; inaccessible or non-tabular charts need manual entry. Reload the unpacked extension after changing its files.

## Size comparisons

When adding a chart, specify whether its numbers describe the garment or the wearer's body. Garment charts can include chest, waist, and hip circumferences; flat widths should be doubled before entry. Results use the selected snug, regular, or relaxed ease preference. Body charts can include minimum and maximum ranges. The app withholds a recommendation when a required body measurement is missing or no size accommodates the entered measurements. Garment length is recorded but is not part of the current ranking. Chest-only charts and profiles remain supported as one-dimensional comparisons.

Public guides require a product image, an HTTPS source link, and rights confirmation. Guides are labeled seller-entered and are not independently verified. Do not treat a result as a guaranteed fit.

## Data, accounts, and privacy

Camera frames are processed in the browser and are not uploaded by the live preview. The clothing parser and pose tracking models also run locally in the browser. Uploaded products, charts, fit profiles, and saved looks associated with an account are stored in the server's SQLite database; browser-only wardrobe data stays in that browser. Passwords use salted scrypt hashes, sessions use expiring HttpOnly cookies, and password reset links are one-use and expire after 30 minutes. Password recovery email requires SMTP configuration. Account deletion removes the account and its associated server data.

For a local run, SQLite data is stored under `data/etryroom.sqlite3`. Back it up before moving or upgrading the installation.

## Deploy with HTTPS

For a public server, point a domain to the host and allow inbound ports 80 and 443. Copy `.env.example` to `.env`, set the domain and canonical HTTPS URL, and configure a transactional SMTP provider. Then start the production profile:

```sh
docker compose --profile production up -d --build
```

Caddy obtains and renews TLS certificates. The application is only exposed through the HTTPS proxy in production. The backup service creates a consistent SQLite backup daily and retains the newest 14 copies in the `etryroom_backups` Docker volume. Copy backups to separate storage and rehearse restores; a backup on the same host does not protect against host loss.

Before accepting customers, configure a real domain, test account recovery and restore procedures, review the privacy policy and terms for the business, and set up monitoring and customer support. The checked-in `basic_shirt.obj` and original SMPL-X/Pyrender path are experiments and are not used by the web fitting experience.
