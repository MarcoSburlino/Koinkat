# Homebrew cask for a personal tap (repository: marcosburlino/homebrew-koinkat).
# The sha256 is the official digest GitHub reports for the v0.1.0 release asset.
cask "koinkat" do
  version "0.1.0"
  sha256 "5a9077bb6d1c795d652a6e59240e48842e50ae91e33acb2eb9b9fd0a3885c069"

  url "https://github.com/MarcoSburlino/Koinkat/releases/download/v#{version}/Koinkat_#{version}_aarch64.dmg"
  name "Koinkat"
  desc "Local-first multi-currency personal finance manager"
  homepage "https://github.com/MarcoSburlino/Koinkat"

  depends_on arch: :arm64
  depends_on macos: ">= :big_sur"

  app "Koinkat.app"

  zap trash: [
    "~/Library/Application Support/com.koinkat.app",
    "~/Library/Caches/com.koinkat.app",
    "~/Library/Preferences/com.koinkat.app.plist",
    "~/Library/Saved Application State/com.koinkat.app.savedState",
    "~/Library/WebKit/com.koinkat.app",
  ]

  caveats <<~EOS
    Koinkat releases are not signed or notarized by Apple. To install
    without the Gatekeeper "damaged app" block, use:

      brew install --cask --no-quarantine koinkat

    If the app was already installed and macOS reports it as damaged,
    clear the quarantine flag instead:

      xattr -cr /Applications/Koinkat.app
  EOS
end
