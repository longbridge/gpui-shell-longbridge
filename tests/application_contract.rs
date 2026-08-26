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
    assert!(
        main.contains("priceChart") && main.contains("allocationChart"),
        "read-only market and allocation charts must remain wired"
    );
    // The forbidden list is about surfaces that would edit a watchlist or reach
    // the order book -- not about text state as such. `InputState` came off it
    // when the lists grew filters: a filter narrows what is already on screen,
    // writes nothing, and asks the API for nothing.
    for forbidden in ["Add symbol", "Remove", "Trades", "Bid", "Ask"] {
        assert!(
            !main.contains(forbidden) && !ui.contains(forbidden) && !market.contains(forbidden),
            "forbidden editing or trading surface {forbidden}"
        );
    }
    assert!(
        main.matches("InputState.new(").count() == 2
            && main.contains("Filter watchlist")
            && main.contains("Filter holdings"),
        "the only retained text state may be the two list filters"
    );
    assert!(
        market.contains("export function filterRows"),
        "filtering must stay a pure function outside the render path"
    );

    // Both lists virtualize, and both are real tables: `row_count` describes
    // the whole collection so a window onto it still announces its size.
    for id in ["watchlist", "holdings"] {
        assert!(
            main.contains(&format!("v_virtual_list(`${{id}}-rows`")) || main.contains(id),
            "missing list {id}"
        );
    }
    assert!(
        main.contains("Table.new(`${id}-table`)") && main.contains(".row_count(rows.length + 1)"),
        "both lists must be virtualized tables that announce their full size"
    );
    assert!(
        ui.contains("TableHead.new(") && ui.contains("TableCell.new(") && ui.contains("TableRow.new("),
        "rows and headers must be table parts rather than styled flex containers"
    );
    assert!(main.contains("const tokens = cx.theme()"));
    assert!(!main.contains(".text_color(\"") && !ui.contains(".text_color(\""));
    assert!(!main.contains("rgb(") && !ui.contains("rgb("));
    // Each page owns its scrolling now, and each does it the way its content
    // needs: Portfolio is one scrolling column, Watchlist virtualizes its rows
    // and pairs a Scrollbar with them by name. Neither paints a window bar.
    assert!(
        main.contains(".overflow_y_scroll()"),
        "the portfolio column must remain vertically scrollable"
    );
    assert!(
        main.contains("v_virtual_list(\"watchlist-rows\"")
            && main.contains("Scrollbar.vertical(\"watchlist-rows\")"),
        "the watchlist must virtualize its rows and pair a scrollbar with them by name"
    );
    assert!(
        main.contains("h_resizable(\"watchlist-workspace\")") && main.contains("resizable_panel()"),
        "the watchlist and detail panes must be panels of one resizable group"
    );

    // A row inside a virtual list cannot register a handler: it is rebuilt on
    // every scrolled frame, so selection belongs to the list.
    assert!(
        main.contains(".on_item_click(") && !ui.contains(".on_click(onSelect)"),
        "watchlist selection must come from the list's on_item_click"
    );

    // Both bound anchored surfaces are exercised, and the pointer affordances
    // with them.
    assert!(
        main.contains("Popover.new(\"watchlist-menu\")")
            && main.contains("Popover.new(\"allocation-help\")"),
        "both Popover scenarios must stay wired"
    );
    assert!(
        ui.contains(".role(\"menu_item\")") && ui.contains(".role(\"menu\")"),
        "the popup menu must announce itself as a menu"
    );
    assert!(ui.contains(".tooltip("), "pointer hints must stay wired");
}
