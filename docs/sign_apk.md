# Android APK Signing in GitHub Actions CI

This guide provides a comprehensive walkthrough for generating a release keystore, configuring GitHub repository secrets, and automating the production signing of the **Zoemini Print** Android APK in GitHub Actions CI.

---

## 1. Why Code Signing is Required

Android requires that all installed applications be digitally signed with an RSA certificate:
- **Application Integrity**: Ensures that the compiled APK has not been tampered with or corrupted in transit.
- **Identity & Updates**: Android checks that subsequent version updates are signed with the exact same certificate key. If the signing key changes, Android blocks updates with a certificate mismatch error (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
- **Distribution**: Both direct APK downloads (sideloading) and app repositories (F-Droid, Google Play) require properly signed release binaries.

---

## 2. Generating a Production Keystore Locally

You should generate the signing key **locally** on a secure machine using the Java `keytool` utility (included with any JDK):

```bash
keytool -genkey -v \
  -keystore release-keystore.jks \
  -alias zoemini \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

### Prompt Details:
- **Keystore Password**: Choose a strong passphrase (e.g., 20+ characters).
- **First and Last Name**: Your name or organization (e.g., `Michael Schuldes`).
- **Organizational Unit / Organization**: e.g., `Zoemini Open Source Project`.
- **City / State / Country Code**: e.g., `DE` or `US`.
- **Key Password**: Press `ENTER` to use the same password as the keystore.

> [!WARNING]
> **Backup Your Keystore Securely!**
> Never commit `release-keystore.jks` to Git (it is already included in `.gitignore`). Store an encrypted copy in a password manager or secure offline backup. If you lose this key, you will permanently lose the ability to update existing installations of your app.

---

## 3. Base64 Encoding the Keystore for GitHub Secrets

GitHub repository secrets only accept UTF-8 text strings, whereas `.jks` is a binary format. Convert the keystore into a single-line base64 string:

### Linux:
```bash
base64 -w 0 release-keystore.jks > keystore.base64.txt
```

### macOS:
```bash
base64 -i release-keystore.jks -o keystore.base64.txt
```

### Windows (PowerShell):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release-keystore.jks")) | Out-File -Encoding ascii keystore.base64.txt
```

---

## 4. Configuring GitHub Repository Secrets

1. Open your repository on GitHub: `https://github.com/MichaelSchuldes/zoemini-ivy2-print`.
2. Navigate to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret** for each of the following 4 secrets:

| Secret Name | Description | Example Value |
| :--- | :--- | :--- |
| `KEYSTORE_BASE64` | The entire base64 string from `keystore.base64.txt` | `MIIKpgIBAzCCCm8GCSqGSIb3...` |
| `KEYSTORE_PASSWORD` | The password used to create the keystore | `MySecureKeystorePass123!` |
| `KEY_ALIAS` | The key alias specified during `keytool` generation | `zoemini` |
| `KEY_PASSWORD` | The private key password | `MySecureKeystorePass123!` |

---

## 5. Gradle Build Configuration

The project's [`android/app/build.gradle`](file:///home/schuldes/Documents/projects/zoemini-ivy2-print/android/app/build.gradle) is already configured to read these environment variables dynamically:

```groovy
android {
    ...
    signingConfigs {
        release {
            def keystoreFile = System.getenv("KEYSTORE_FILE")
            if (keystoreFile && file(keystoreFile).exists()) {
                storeFile file(keystoreFile)
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            def keystoreFile = System.getenv("KEYSTORE_FILE")
            if (keystoreFile && file(keystoreFile).exists()) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

- When `KEYSTORE_FILE` is provided, Gradle signs the APK with your official release key.
- If `KEYSTORE_FILE` is not set (e.g. for untrusted pull requests from forks), Gradle gracefully falls back to the default debug key so CI builds still succeed without exposing secrets.

---

## 6. GitHub Actions Workflow Configuration

In [`.github/workflows/build-apk.yml`](file:///home/schuldes/Documents/projects/zoemini-ivy2-print/.github/workflows/build-apk.yml), the build step decodes the secret into a temporary keystore file, runs Gradle, and removes the keystore afterwards:

```yaml
      - name: Build APKs (Release & Debug)
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
        run: |
          cd android
          if [ -n "$KEYSTORE_BASE64" ]; then
            echo "Decoding release keystore from GitHub secret..."
            echo "$KEYSTORE_BASE64" | base64 -d > app/release.jks
            export KEYSTORE_FILE="release.jks"
          else
            echo "KEYSTORE_BASE64 not configured; building release APK with debug signature."
          fi

          ./gradlew assembleDebug assembleRelease --stacktrace
          rm -f app/release.jks

          cp app/build/outputs/apk/release/com.michaelschuldes.zoemini-ivy2-print-release.apk \
             app/build/outputs/apk/release/com.michaelschuldes.zoemini-ivy2-print.apk
```

---

## 7. Verifying APK Signatures

You can verify that the output APK was signed correctly using Android's `apksigner` tool:

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --verbose --print-certs com.michaelschuldes.zoemini-ivy2-print-release.apk
```

Expected output:
```text
Verifies
Verified using v1 scheme (JAR signing): true
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v4 scheme (APK Signature Scheme v4): false
Number of signers: 1
Signer #1 certificate DN: CN=Michael Schuldes, OU=Zoemini, O=Zoemini Project, C=DE
Signer #1 key algorithm: RSA
Signer #1 key size (bits): 2048
Signer #1 SHA-256 digest: 8f9b...
```

---

## 8. Troubleshooting

### `Keystore was tampered with, or password was incorrect`
- Check for trailing newlines or whitespace in `KEYSTORE_BASE64`.
- Re-generate the base64 string using `base64 -w 0 release-keystore.jks`.
- Verify that `KEYSTORE_PASSWORD` matches what was entered in `keytool`.

### `Cannot recover key`
- Occurs when `KEY_PASSWORD` differs from `KEYSTORE_PASSWORD`. Ensure both secrets are entered accurately in GitHub repository secrets.

### `Alias does not exist`
- Ensure `KEY_ALIAS` exactly matches the alias used during `keytool -alias <name>` (e.g. `zoemini`). You can list aliases inside a keystore with:
  ```bash
  keytool -list -v -keystore release-keystore.jks
  ```
