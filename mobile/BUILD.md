# Barkaati Inventory — offline mobile app

This folder is a standalone, fully offline shop manager built with Capacitor 7,
React 18, Vite and on-device SQLite encrypted with SQLCipher. It mirrors the
web app's data model so a shop can move from the web app to the phone.

- App id: `com.barkaati.inventory`
- App name: `Barkaati Inventory`
- Web assets: `dist/` (built by Vite)
- Native projects: `android/` (generated), iOS can be added later
- Database: SQLite + SQLCipher, local to the app sandbox
- No server, no network calls, no cloud account

---

## 1. Requirements

| Tool | Version |
| --- | --- |
| Node.js | 20 or newer |
| JDK | 17 or 21 (do **not** use 25 with Gradle 8.11.1) |
| Android Studio | latest, with Android SDK 35 |
| Android SDK Platform | 35 |
| Android Build-Tools | 35.0.0 |
| Android Platform-Tools | latest (`adb`) |
| Gradle | provided by the wrapper (8.11.1) |

On Linux this JDK is known to work:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"
java -version   # should print 21.x
```

Install the Android SDK through Android Studio (Settings → Languages & Frameworks
→ Android SDK), then point the project at it:

```bash
# mobile/android/local.properties
sdk.dir=/home/<you>/Android/Sdk
```

Or export `ANDROID_HOME` / `ANDROID_SDK_ROOT` before building.

---

## 2. Install and build the web bundle

```bash
cd mobile
npm install
npm run build
```

`npm run build` writes the production bundle to `mobile/dist/`.

`npm run dev` only works in a browser for UI preview. The database layer requires
the native SQLite plugin, so use an Android/iOS build for real data.

---

## 3. Sync Capacitor

The Android project already exists. After installing plugins or changing web
code, sync it:

```bash
cd mobile
npm run build
npx cap sync android
```

If you ever need to regenerate the Android project from scratch:

```bash
npx cap add android
```

Then re-apply the manifest settings listed in section 11.

---

## 4. Build a debug APK from the command line

```bash
cd mobile
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Or use the shortcut from `mobile/`:

```bash
npm run android:debug
```

Output:

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a connected phone:

```bash
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or open the project in Android Studio and press Run:

```bash
cd mobile
npx cap open android
```

> This project has been built successfully on the development machine with
> `assembleDebug`, producing a debug APK. Re-run the commands above after code
> changes to rebuild it.

---

## 5. First run

1. Install and open the app.
2. Choose a 6-digit PIN. It is stored only as a PBKDF2-SHA256 hash.
3. Optionally enable biometric unlock in **More → Settings → App lock**.
4. Add your shop details in **Settings → Shop details**.
5. Add categories and units in **Settings → Catalog** (required before adding
   products, unless you import a backup).
6. Add products in **Products**, then start selling in **Sell**.

The database is created on first unlock. The random SQLCipher key is kept in the
app's private preferences; the PIN is only used to authorize opening it.

---

## 6. Migrating data from the web app

1. In the web app, export a SQL dump (server backup / `backup.sql`).
2. Copy the `.sql` file to the phone (USB, Drive, email — any local file).
3. In the mobile app: **More → Settings → Backup & restore → Import SQL backup**.
4. Pick the file and confirm. This **replaces** all data on the phone.
5. The importer maps web column names, skips unknown tables/columns, and rebuilds
   invoice numbering, sale line totals and customer names.

Notes:

- A SQL dump contains data only. Product images and documents are **not** in it.
  Re-add images on the phone, or use a ZIP backup made by the mobile app.
- ZIP backups are the only way to move images/documents between mobile installs.
- Test an import on a spare device first if the web app has customized tables.

---

## 7. Backup and restore

**Settings → Backup & restore**

- **Export ZIP** — includes all database tables plus `images/` and `docs/` files.
  Save it off the phone (Drive, SD card, computer).
- **Export SQL** — data only, useful for analysis or moving to the web app.
- **Import ZIP** — restores a ZIP made by this app.
- **Import SQL** — restores a web-app SQL dump.

The Android manifest sets `android:allowBackup="false"`, so uninstalling the app
or clearing app data permanently deletes the database. Keep regular ZIP backups.

---

## 8. Bluetooth / ESC-POS printing

Supported: 58 mm ESC/POS thermal printers using Bluetooth Classic SPP (most
cheap portable printers). 80 mm printers usually work but receipts are formatted
for 32 characters.

1. Pair the printer in **Android Settings → Bluetooth** first.
2. Open the app: **More → Settings → Printer**.
3. Tap **Find paired printers**, choose your printer, then **Test print**.
4. On Android 12+, allow the **Nearby devices** permission when prompted. The
   app asks for `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` on first launch (see
   `MainActivity.java`). If you dismissed it, grant it in system app settings.

If the printer does not appear:

- Make sure it is paired in Android settings and is a Classic/SPP printer, not a
  BLE-only printer.
- Grant `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` in system app settings.
- Turn the printer on and keep it close during pairing.

iOS does not expose Bluetooth Classic SPP to apps, so Classic printer support is
Android-only. BLE printing is attempted as a fallback but depends on the printer.

---

## 9. Barcode scanner

The POS screen can scan barcodes with the camera. It uses the bundled ML Kit
model, so scanning works offline and without Google Play Services.

- Grant the camera permission on first scan.
- Supported formats: Code 128, Code 39, Code 93, EAN-13/8, UPC-A/E, ITF, QR,
  Data Matrix, PDF417.
- The camera preview is rendered behind a transparent overlay; tap **Cancel** or
  press Back to stop scanning.

Hardware keyboard-wedge scanners also work: focus the search box and scan.

---

## 10. App lock and security model

- SQLCipher encrypts the database with a random 32-byte key.
- The key is stored in Capacitor Preferences inside the app sandbox.
- The 6-digit PIN is hashed with PBKDF2-SHA256 (120,000 iterations + salt).
- Biometric unlock uses the device fingerprint/face prompt. The PIN remains the
  fallback.
- **Forgot PIN** erases the local database. Restore from a ZIP backup afterwards.
- The app makes no network requests and does not request internet permission.

---

## 11. Android manifest settings already applied

`android/app/src/main/AndroidManifest.xml` contains:

- `android:allowBackup="false"` and `android:fullBackupContent="false"`
- `android:usesCleartextTraffic="false"`
- `CAMERA`
- `BLUETOOTH`, `BLUETOOTH_ADMIN` (maxSdkVersion 30)
- `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`
- `ACCESS_FINE_LOCATION` (maxSdkVersion 30, needed for Bluetooth on older Android)
- ML Kit metadata: `com.google.mlkit.vision.DEPENDENCIES = barcode_ui`
- Optional features: Bluetooth and camera (so the app installs on devices
  without them)

If you regenerate `android/`, re-apply these entries.

---

## 12. Troubleshooting

**`SDK location not found`**
Create `mobile/android/local.properties` with `sdk.dir=/path/to/Android/Sdk`, or
export `ANDROID_HOME`.

**`Unsupported class file major version 69` / Gradle Java error**
You are running JDK 25. Use JDK 17 or 21 and set `JAVA_HOME`.

**Gradle wrapper download times out**
The wrapper needs to download Gradle 8.11.1 once. Check network/proxy, or use a
locally installed Gradle 8.11.1. A timeout here is not an app error.

**White screen after launch**
Run `npm run build` then `npx cap sync android`, and rebuild. Check `adb logcat`
for JavaScript errors.

**`file is not a database` / SQLCipher error**
The database key no longer matches. Use **Forgot PIN → Erase** and restore a ZIP
backup.

**Camera preview is black**
Close other camera apps, make sure camera permission is granted, and rebuild
after `npx cap sync android`. The scanning overlay relies on the transparent
WebView background styles in `src/index.css`.

**Printer prints garbage**
The printer is not ESC/POS or the baud/Bluetooth profile is wrong. Test with a
58 mm ESC/POS printer.

**Bluetooth plugin missing**
`cordova-plugin-bluetooth-serial` is installed and synced by
`npx cap sync android`. Confirm `npx cap ls android` lists it, then rebuild.

---

## 13. Known limitations

- Android is the primary target. iOS needs its own native build and cannot use
  Bluetooth Classic SPP printers.
- No background sync: this is intentionally offline-only.
- SQL import does not transfer images/documents from the web app.
- The debug APK is built locally; a signed release APK/AAB still needs a
  keystore and `assembleRelease` / `bundleRelease`.
