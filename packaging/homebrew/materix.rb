# Homebrew cask for Materix (macOS).
#
# Host this in a personal tap so users can `brew install --cask
# DatanoiseTV/tap/materix`:
#   1. Create a repo named `homebrew-tap` under your GitHub account.
#   2. Put this file at `Casks/materix.rb` in that repo.
#   3. Cut a Materix release so the .dmg URLs below exist, then fill in the
#      real sha256 values (`shasum -a 256 Materix_*.dmg`).
#
# The release workflow builds separate Apple-Silicon and Intel .dmg files, so
# the cask ships both and Homebrew picks by architecture.
cask "materix" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.0"

  # Replace these with the real checksums once v0.1.0 is published.
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/DatanoiseTV/Materix/releases/download/v#{version}/Materix_#{version}_#{arch}.dmg"
  name "Materix"
  desc "Multi-account Matrix client for web and desktop"
  homepage "https://github.com/DatanoiseTV/Materix"

  depends_on macos: ">= :catalina"

  app "Materix.app"

  zap trash: [
    "~/Library/Application Support/org.materix.app",
    "~/Library/Caches/org.materix.app",
    "~/Library/Preferences/org.materix.app.plist",
    "~/Library/Saved Application State/org.materix.app.savedState",
  ]
end
