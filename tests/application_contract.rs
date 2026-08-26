use std::{fs, path::PathBuf};

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app")
}

#[test]
fn manifest_grants_longbridge_network_access() {
    let root = app_dir();
    let manifest = gpui_shell::plugin::PluginManifest::read(&root).expect("plugin manifest");
    let capabilities = manifest.capabilities(&root, &std::env::temp_dir());

    assert!(capabilities.may_reach("openapi.longbridge.com"));
    assert!(capabilities.may_reach("openapi-quote.longbridge.com"));
    assert!(capabilities.may_request("https", "openapi.longbridge.com", None, "POST", "/any/path"));
    assert!(!capabilities.may_run("longbridge"));
}

#[test]
fn application_exposes_api_backed_read_only_views() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    let market = fs::read_to_string(app_dir().join("market.js")).expect("market.js");

    assert!(
        main.contains("/v1/watchlist/groups"),
        "watchlist must load from the read-only API"
    );
    assert!(
        market.contains("sortLikeTerminal"),
        "watchlist must use terminal-compatible sorting"
    );
    for expected in ["Watchlist", "Stock Details", "Portfolio", "Holdings"] {
        assert!(main.contains(expected), "missing view copy {expected}");
    }
    for forbidden in [
        "Add symbol",
        "Remove",
        "InputState",
        "Trades",
        "Bid",
        "Ask",
        "chart",
    ] {
        assert!(
            !main.contains(forbidden) && !ui.contains(forbidden) && !market.contains(forbidden),
            "forbidden editing or trading surface {forbidden}"
        );
    }
    assert!(main.contains("const tokens = cx.theme()"));
    assert!(!main.contains(".text_color(\"") && !ui.contains(".text_color(\""));
    assert!(!main.contains("rgb(") && !ui.contains("rgb("));
}
