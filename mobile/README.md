# Lumen Capture

The capture station for **Lumen** booth mode. This Flutter app runs on a phone,
takes a face photo with the front (or rear) camera, and POSTs it to the Lumen
backend at `http://<host>/api/analyze`. The backend runs the skin-type analysis
and broadcasts the report to any `?display` screen over WebSocket.

The backend host is editable in-app (tap the host chip); it defaults to
`192.168.1.2:3000`. The phone and the machine running the backend must be on the
same LAN — point the app at the backend's LAN IP, not `localhost`.

## Prerequisites (both platforms)

- Flutter 3.x (`flutter doctor` should be green)
- The Lumen backend running and reachable on your LAN (`npm start` in the repo root)

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

## Run on iOS

iOS builds require **macOS + Xcode** — there is no way to build iOS from Windows
or Linux. The `ios/` folder is already in the repo, so you don't need to
regenerate it.

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
4. If Xcode says the bundle ID `com.lumen.lumenCapture` is taken, change it to
   something unique (e.g. `com.lumen.lumenCapture.yourname`).
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
