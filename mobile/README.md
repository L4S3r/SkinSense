# Meloniq Capture

The capture station for **Meloniq** booth mode. This Flutter app runs on a phone,
takes a face photo with the front (or rear) camera, and POSTs it to the Meloniq
backend at `http://<host>/api/analyze`. The backend runs the skin-type analysis
and broadcasts the report to any `?display` screen over WebSocket.

The backend host is editable in-app (tap the host chip); it defaults to
`192.168.1.2:3000`. The phone and the machine running the backend (PC or Linux mini-server) must be on the same LAN — point the app at the backend's LAN IP, not `localhost`.

## Network & Firewall Setup (Windows & Linux Mini-Servers)

When connecting a phone to a backend running on a Windows PC or Linux mini-server laptop over Wi-Fi or Ethernet:

### 1. Firewall Port Rule (Port 3000)

- **Linux Mini-Server (ufw - Ubuntu/Debian)**:
  ```bash
  sudo ufw allow 3000/tcp
  ```
- **Linux Mini-Server (firewalld - Fedora/RHEL)**:
  ```bash
  sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent && sudo firewall-cmd --reload
  ```
- **Windows Host (PowerShell as Administrator)**:
  ```powershell
  New-NetFirewallRule -DisplayName "Meloniq Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any
  ```

### 2. Device Connection Scenarios

- **Physical Android/iOS Device (LAN/Wi-Fi/Ethernet)**:
  Enter your backend host IP and port: `192.168.1.45:3000`. Note: If your Linux mini-server is on Ethernet and phone is on Wi-Fi, ensure your router bridges Ethernet and Wi-Fi to the same subnet (`192.168.1.x`).
- **Android Emulator**:
  Enter `10.0.2.2:3000` (maps Android emulator virtual net to host).
- **USB Tunneling (ADB Reverse)**:
  Run `adb reverse tcp:3000 tcp:3000` on your host machine, then enter `127.0.0.1:3000` in the mobile app.

### 3. Quick 5-Second Diagnostics

Open Chrome/Safari on your mobile device and test:
```text
http://<backend-ip>:3000/api/health
```
If it returns `{"status":"ok"...}`, the mobile app will connect immediately!

## Prerequisites (both platforms)

- Flutter 3.x (`flutter doctor` should be green)
- The Meloniq backend running and reachable on your LAN (`cd backend && npm start`)

```bash
cd mobile
flutter pub get
flutter analyze   # must be clean before Flutter work is considered done
```

## Run on Android

```bash
flutter run                # onto a connected Android device
flutter build apk --debug  # ~9 min first build; the camera KGP warning is benign
```

Cleartext HTTP over the LAN is enabled via `usesCleartextTraffic="true"` in the
Android manifest.

## Building for iOS via Codemagic CI/CD (No Mac required)

If you are developing on **Windows** or **Linux**, you can build iOS `.ipa` / `.app` packages automatically using **Codemagic** with the included `codemagic.yaml`:

1. Connect your repository (GitHub / GitLab / Bitbucket) to [Codemagic](https://codemagic.io/).
2. Codemagic will automatically detect `codemagic.yaml`.
3. Choose the **`ios-release`** or **`ios-debug`** workflow and click **Start new build**.
4. Once completed, download the generated `.ipa` file directly from the Codemagic artifacts tab and install it onto your iPhone using AltServer, Sideloadly, TestFlight, or App Store Connect.

## Run on iOS (Local macOS Build)

iOS local builds require **macOS + Xcode**. The `ios/` folder is already configured in the repo.

### 1. Install the toolchain (macOS)

```bash
# Xcode: install from the Mac App Store, then:
sudo xcodebuild -license accept
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# CocoaPods (native deps for the camera plugin):
sudo gem install cocoapods

# Flutter, if not already installed:
brew install --cask flutter

flutter doctor   # confirm Xcode + CocoaPods show checkmarks
```

### 2. Fetch dependencies

```bash
cd mobile
flutter pub get
cd ios && pod install && cd ..
```

### 3. Run

**Simulator** — fast for checking UI layout, but the camera plugin gives no live
feed on Simulator, so the scan flow can't be tested there:

```bash
open -a Simulator
flutter run
```

**Real iPhone** — required to test the actual capture flow:

1. Plug in the iPhone, unlock it, tap **Trust**.
2. Open `ios/Runner.xcworkspace` in Xcode (the `.xcworkspace`, not `.xcodeproj`).
3. Select the **Runner** target → **Signing & Capabilities** → set **Team** to
   your Apple ID. A free Apple ID works for running on your own device.
4. If Xcode says the bundle ID `com.meloniq.meloniqCapture` is taken, change it to
   something unique (e.g. `com.meloniq.meloniqCapture.yourname`).
5. `flutter run` (or the Run button in Xcode).
6. First launch: on the iPhone, **Settings → General → VPN & Device Management**
   → trust your developer certificate, then relaunch.

A free Apple ID builds expire after ~7 days (re-run from Xcode to renew). A paid
Apple Developer account ($99/yr) is only needed for TestFlight / App Store or
longer-lived builds.

### iOS-specific config (already set)

`ios/Runner/Info.plist` contains:

- `NSCameraUsageDescription` — required, or iOS terminates the app when it opens
  the camera.
- `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` — the iOS equivalent of
  Android's `usesCleartextTraffic`, so the plain-HTTP LAN call to the backend is
  allowed. Tighten this before any public (non-LAN) deployment.
