# Android source for a later local build

The generated native project is in `apps/mobile/android`, alongside the Expo
application source in `apps/mobile/app`. No Android build was run or scheduled.
The project was generated successfully with Expo SDK 58 using
`expo-template-bare-minimum@58.0.31` (0BSD). Its Gradle wrapper is included.

To build later, install the pinned Node/pnpm versions and Android Studio/JDK 17,
then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @yapesa/mobile android
```

Or open `apps/mobile/android` in Android Studio after installing workspace
dependencies. Signing keys are excluded. The Android Gradle plugin generates its default
debug key locally; production signing is not configured. Generated icons are placeholders.
App configuration or native dependency changes should be followed by regeneration
and a review of the native source diff. Do not run a clean prebuild over manual
native changes without preserving them first.
