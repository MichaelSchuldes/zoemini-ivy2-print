# Publishing Zoemini Print to F-Droid via GitHub CI

This guide details how to publish the **Zoemini Print** Android application to **F-Droid**, the primary free and open-source Android app repository.

It covers both:
1. **Official F-Droid Inclusion** (Submitting a metadata recipe to `fdroiddata` so F-Droid's build servers automatically compile and sign releases from git tags).
2. **Self-Hosted F-Droid Repository** (Automating an independent, signed F-Droid repository hosted directly via GitHub Pages and GitHub Actions CI).

---

## 1. Overview & F-Droid Philosophy

F-Droid has strict inclusion requirements centered around software freedom and user privacy:
- **100% Free & Open Source**: All source code, dependencies, and bundled assets must have OSI-compliant licenses (e.g. MIT, Apache 2.0, GPL).
- **Zero Proprietary Blobs**: No closed-source tracking SDKs, Google Play Services dependencies, or proprietary crash reporters.
- **Source-Built Binaries**: For the official repository, F-Droid's automated build cluster builds the APK from clean source code in a sandboxed Debian container.
- **Reproducible Builds**: Builds must be deterministic and verifiable.

**Zoemini Print** is 100% compliant with F-Droid guidelines:
- Licensed under the open-source MIT License.
- Uses standard AndroidX open-source components (`androidx.appcompat`, `androidx.webkit`).
- Connects directly to the printer over local Bluetooth SPP with zero cloud dependencies or analytics.

---

## 2. Option A: Submitting to Official F-Droid Main Repository (`fdroiddata`)

The official F-Droid repository builds new app releases automatically by monitoring git release tags in this repository. Once the initial recipe is merged, **no CI setup on your end is needed to publish updates—pushing a git tag triggers F-Droid automatically**.

### Step 1: Prepare Fastlane Metadata
F-Droid automatically imports screenshots, descriptions, icons, and changelogs from a standard Fastlane folder structure within your repository:

```text
fastlane/metadata/android/
└── en-US/
    ├── title.txt                  # "Zoemini Print"
    ├── short_description.txt      # 80-char summary
    ├── full_description.txt       # Detailed markdown description
    ├── images/
    │   ├── icon.png               # 512x512 app icon
    │   └── phoneScreenshots/      # 1080p preview screenshots
    └── changelogs/
        └── 1.txt                  # Changelog for versionCode 1
```

### Step 2: Create the F-Droid Metadata Recipe
Create a metadata recipe file named after the application ID: `metadata/com.michaelschuldes.zoemini_ivy2_print.yml`.

```yaml
Categories:
  - Graphics
  - System
License: MIT
AuthorName: Michael Schuldes
WebSite: https://github.com/MichaelSchuldes/zoemini-ivy2-print
SourceCode: https://github.com/MichaelSchuldes/zoemini-ivy2-print
IssueTracker: https://github.com/MichaelSchuldes/zoemini-ivy2-print/issues

AutoName: Zoemini Print
Summary: Web & Native Print Studio for Canon Zoemini 2 / Ivy 2
Description: |-
  Zoemini Print is an open-source print studio for the Canon Zoemini 2 and
  Canon Ivy 2 ZINK photo printers. It connects over Bluetooth RFCOMM without
  requiring proprietary manufacturer apps or accounts.

  Features:
  * Full 2x3" photo paper (ZP-2030) and 2x Round Cutout sticker (ZP-2030-2C) support
  * Crop, pan, zoom, 90° step rotation, and fine straightening
  * Brightness, contrast, and saturation color adjustments
  * Multi-page PDF page selection and vector SVG rasterization
  * Direct Android System Share sheet integration ("Share to Zoemini Print")
  * Battery telemetry, cover sensor detection, and SmartSheet verification

RepoType: git
Repo: https://github.com/MichaelSchuldes/zoemini-ivy2-print.git

Builds:
  - versionName: 1.0.0
    versionCode: 1
    commit: v1.0.0
    subdir: android
    gradle:
      - yes
    prebuild:
      - mkdir -p app/src/main/assets
      - cp -r ../index.html ../manifest.json ../sw.js ../css ../js ../icons app/src/main/assets/

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags
CurrentVersion: 1.0.0
CurrentVersionCode: 1
```

### Step 3: Test the Recipe Locally
Install the F-Droid server tools on Linux:
```bash
sudo apt install fdroidserver
git clone https://gitlab.com/fdroid/fdroiddata.git
cd fdroiddata
cp /path/to/com.michaelschuldes.zoemini_ivy2_print.yml metadata/
fdroid checkupdates com.michaelschuldes.zoemini_ivy2_print
fdroid lint com.michaelschuldes.zoemini_ivy2_print
```

### Step 4: Submit the Merge Request
1. Fork `https://gitlab.com/fdroid/fdroiddata` on GitLab.
2. Commit `metadata/com.michaelschuldes.zoemini_ivy2_print.yml` to a new branch (e.g., `add-zoemini-print`).
3. Open a Merge Request against `fdroid/fdroiddata:master`.
4. F-Droid CI bots will test-build the package and post the result in the MR. Once reviewed by F-Droid maintainers, the MR is merged.
5. Within 24–48 hours, **Zoemini Print** will appear in the official F-Droid app store catalog.

---

## 3. Option B: Self-Hosted F-Droid Repository via GitHub Actions & GitHub Pages

If you prefer to distribute signed release APKs directly to F-Droid client users immediately without waiting for official `fdroiddata` review cycles, you can host your own signed F-Droid repository via GitHub Pages.

### How it Works:
1. When you push a git tag (e.g. `v1.0.0`), GitHub Actions compiles the signed APK.
2. The workflow initializes an F-Droid repository structure using the official `fdroidserver` Docker image.
3. It signs the repository index (`index-v1.jar`) using your repository signing key.
4. It pushes the repository to the `gh-pages` branch.
5. Users add `https://michaelschuldes.github.io/zoemini-ivy2-print/fdroid/repo` to their F-Droid client app.

### GitHub Actions Workflow: `.github/workflows/fdroid-repo.yml`

```yaml
name: Update F-Droid Repository

on:
  release:
    types: [ published ]
  workflow_dispatch:

permissions:
  contents: write
  pages: write

jobs:
  fdroid:
    name: Build & Publish F-Droid Repo
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Download Built Release APK
        uses: actions/download-artifact@v4
        with:
          name: com.michaelschuldes.zoemini-ivy2-print-release
          path: fdroid-workspace/repo

      - name: Generate F-Droid Repository Index
        uses: docker://registry.gitlab.com/fdroid/fdroidserver:latest
        with:
          entrypoint: /bin/bash
          args: |
            cd fdroid-workspace
            fdroid init
            fdroid update --create-metadata

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: fdroid-workspace
          destination_dir: fdroid
```

---

## 4. Release Checklist for New Versions

When preparing a new release:
1. **Update `versionCode` and `versionName`** in [`android/app/build.gradle`](file:///home/schuldes/Documents/projects/zoemini-ivy2-print/android/app/build.gradle):
   ```groovy
   versionCode 2
   versionName "1.1.0"
   ```
2. **Update Web Version Strings** in [`manifest.json`](file:///home/schuldes/Documents/projects/zoemini-ivy2-print/manifest.json) and [`index.html`](file:///home/schuldes/Documents/projects/zoemini-ivy2-print/index.html).
3. **Commit & Tag**:
   ```bash
   git add android/app/build.gradle manifest.json index.html
   git commit -m "Bump version to v1.1.0"
   git tag -a v1.1.0 -m "Release v1.1.0"
   git push origin main --tags
   ```
4. **GitHub CI Automated Execution**:
   - The `.github/workflows/build-apk.yml` workflow triggers on the `v*` tag.
   - It syncs all web assets, compiles the signed release APK, and attaches it directly to the GitHub Release.
   - F-Droid's checkupdates scanner detects the new tag and triggers an automated rebuild for all F-Droid app users worldwide.
