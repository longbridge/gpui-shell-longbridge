use std::{fs, path::PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(path: &str) -> String {
    fs::read_to_string(root().join(path)).unwrap_or_else(|error| panic!("read {path}: {error}"))
}

#[test]
fn package_metadata_names_longbridge_lite() {
    let desktop = read("packaging/linux/longbridge-lite.desktop");
    for expected in [
        "Name=Longbridge Lite",
        "Exec=longbridge-lite",
        "Icon=longbridge-lite",
        "Categories=Finance;Office;",
        "StartupWMClass=longbridge-lite",
    ] {
        assert!(desktop.contains(expected), "desktop entry lacks {expected}");
    }

    let plist = read("packaging/macos/Info.plist");
    for expected in [
        "Longbridge Lite",
        "longbridge-lite",
        "com.longbridge.longbridge-lite",
        "longbridge-lite.icns",
    ] {
        assert!(plist.contains(expected), "Info.plist lacks {expected}");
    }

    let shell = read("scripts/package-release.sh");
    assert!(shell.contains("macos-aarch64"));
    assert!(shell.contains("macos-x86_64"));
    assert!(shell.contains("linux-x86_64"));
    assert!(shell.contains("Contents/Resources/app"));
    assert!(shell.contains("share/applications/longbridge-lite.desktop"));
    assert!(shell.contains("share/icons/hicolor/512x512/apps/longbridge-lite.png"));

    let powershell = read("scripts/package-release.ps1");
    assert!(powershell.contains("longbridge-lite-windows-x86_64.zip"));
    assert!(powershell.contains("longbridge-lite.exe"));
    assert!(powershell.contains("app-icon.ico"));

    let icon = read("assets/app-icon.svg");
    assert!(icon.contains("viewBox=\"0 0 128 128\""));
    assert!(icon.contains("#FFE000") && icon.contains("#00DBB6"));
}

#[test]
fn installer_contracts_are_complete() {
    let shell = read("install.sh");
    for expected in [
        "--version",
        "--uninstall",
        "LONGBRIDGE_LITE_BUNDLE_PATH",
        "longbridge/longbridge-lite",
        "SHA256SUMS",
        "sha256sum",
        "shasum",
        "$HOME/.local/longbridge-lite.app",
        "$HOME/Applications/Longbridge Lite.app",
        "$HOME/.local/share/applications",
        "update-desktop-database",
    ] {
        assert!(shell.contains(expected), "install.sh lacks {expected}");
    }

    let powershell = read("install.ps1");
    for expected in [
        "[string]$Version",
        "[switch]$Uninstall",
        "LONGBRIDGE_LITE_BUNDLE_PATH",
        "longbridge/longbridge-lite",
        "SHA256SUMS",
        "Get-FileHash",
        "LocalApplicationData",
        "EnvironmentVariableTarget]::User",
        "WScript.Shell",
        "GetFolderPath('StartMenu')",
    ] {
        assert!(
            powershell.contains(expected),
            "install.ps1 lacks {expected}"
        );
    }
}

#[test]
fn workflow_builds_and_publishes_every_target() {
    let workflow = read(".github/workflows/release.yml");
    for expected in [
        "tags:",
        "- 'v*'",
        "workflow_dispatch:",
        "contents: write",
        "macos-aarch64",
        "macos-x86_64",
        "linux-x86_64",
        "windows-x86_64",
        "cargo build --locked --release",
        "actions/checkout@v4",
        "actions/upload-artifact@v4",
        "actions/download-artifact@v4",
        "SHA256SUMS",
        "gh release",
        "package-release.sh",
        "package-release.ps1",
    ] {
        assert!(
            workflow.contains(expected),
            "release workflow lacks {expected}"
        );
    }

    assert_eq!(
        workflow.matches("actions/upload-artifact@v4").count(),
        4,
        "each native platform build must publish exactly one artifact"
    );
}
