use std::{fs, path::PathBuf};

fn app_dir() -> PathBuf {
    std::env::var_os("LONGBRIDGE_CONTRACT_APP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app"))
}

#[test]
fn application_uses_the_system_font_instead_of_bundling_one() {
    let root = app_dir();
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    let script = fs::read_to_string(root.join("main.js")).expect("application main.js");

    assert!(
        !root.join("assets/fonts").exists(),
        "font assets must not ship with the app"
    );
    assert!(
        !host.contains("include_bytes!") && !host.contains("add_fonts("),
        "the host must not embed or register an application font"
    );
    assert!(
        !script.contains(".font_family("),
        "the application must inherit the system font"
    );
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
    assert!(
        !fs::read_to_string(root.join("gpui-shell.json"))
            .expect("manifest source")
            .contains("/etc"),
        "Omarchy colors replace the old operating-system identity probe"
    );
}

#[test]
fn host_reads_only_the_materialized_omarchy_palette() {
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    assert!(host.contains(".local/state/omarchy/current/theme/colors.toml"));
    assert!(host.contains("HostModule::new(\"omarchy-theme\")"));
    assert!(host.contains("gpui-shell/plugins"), "existing login storage must remain stable");
}

#[test]
fn debug_builds_watch_application_sources() {
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    assert!(host.contains("#[cfg(debug_assertions)]"));
    assert!(host.contains("runtime.watch(&root, window, cx)"));
    assert!(host.contains("watcher.forget()"));
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
    // Sentence case, per the interface's copy rules: a view's name is a noun,
    // not a title. `Stock details` was `Stock Details` before the restyle.
    //
    // Either file counts. A pane's name is written once, on its tab, and the
    // tab is drawn by `panelTitle` in `ui.js`; the pane's own header stopped
    // repeating it, because a pane that names itself twice is two headers.
    for expected in ["Watchlist", "Stock details", "Portfolio", "Holdings"] {
        assert!(
            main.contains(expected) || ui.contains(expected),
            "missing view copy {expected}"
        );
    }
    assert!(
        main.contains("priceChart") && main.contains("allocationChart"),
        "read-only market and allocation charts must remain wired"
    );
    // The forbidden list is about edit controls. Read-only market-detail
    // panels may now use bid, ask, and time-and-sales terminology; `InputState`
    // remains limited to the two list filters, which narrow what is already on
    // screen and never mutate the watchlist.
    for forbidden in ["Add symbol", "Remove"] {
        assert!(
            !main.contains(forbidden) && !ui.contains(forbidden) && !market.contains(forbidden),
            "forbidden editing or trading surface {forbidden}"
        );
    }
    assert!(
        main.matches("InputState.new({ placeholder:").count() == 2
            && main.contains("Filter watchlist")
            && main.contains("Filter holdings"),
        "the only retained text state may be the two list filters"
    );
    assert!(
        market.contains("export function filterRows"),
        "filtering must stay a pure function outside the render path"
    );

    // Both lists are real tables: `row_count` describes the whole collection so
    // a window onto it still announces its size.
    assert!(
        main.contains("Table.new(`${id}-table`)") && main.contains(".row_count(rows.length + 1)"),
        "both lists must be virtualized tables that announce their full size"
    );
    assert!(
        ui.contains("TableHead.new(")
            && ui.contains("TableCell.new(")
            && ui.contains("TableRow.new("),
        "rows and headers must be table parts rather than styled flex containers"
    );
    assert!(main.contains("const tokens = cx.theme()"));
    assert!(!main.contains(".text_color(\"") && !ui.contains(".text_color(\""));
    assert!(!main.contains("rgb(") && !ui.contains("rgb("));
    // Each page owns its scrolling now, and each does it the way its content
    // needs. Neither scrolls as a page: both put the scroll inside the table
    // that has more rows than room, which is the virtualized one, so the window
    // never grows a bar around a whole column and no page nests one scroll
    // inside another. Neither paints a window bar either.
    assert!(
        !main.contains(".overflow_y_scroll()"),
        "no page may scroll as a whole; the table inside it does"
    );
    // Both lists go through one virtualized table, so the list and the bar are
    // named from the same id and cannot drift apart.
    assert!(
        main.contains("v_virtual_list(")
            && main.contains("`${id}-rows`,")
            && main.contains("Scrollbar.vertical(`${id}-rows`)"),
        "both lists must virtualize their rows and pair a scrollbar with them by name"
    );
    // The panes are dock panels now, which is what makes the layout the user's:
    // it is a value they edit and the application only draws it. Both halves
    // have to stay — a panel that nothing registered a class for cannot come
    // back after a restart.
    assert!(
        main.contains("dock_area(this.workspaceDock)")
            && main.contains("DockArea.register_panel(\"watchlist\", WatchlistPanel)")
            && main.contains("DockArea.register_panel(\"detail\", DetailPanel)"),
        "the watchlist and detail panes must be panels of the workspace dock"
    );
    // Base draws none of this once gpui-shell is in the picture.
    //
    // `dockFrame` is on this list for a reason worth writing down, because it
    // was taken off once. gpui-shell's `ScriptDockSkin::render_dock` replaces
    // base's `render_dock` whether or not an application supplies chrome, and
    // the default chrome returns the content bare -- without the box base wraps
    // a dock in. A side dock with no width is not a column, so it drops into
    // the flow below the centre and sizes to its content. Removing `dockFrame`
    // does not restore base's box; it only swaps our missing one for the
    // shell's.
    let ui_source = &ui;
    for chrome in ["dockTabBar", "dockDropHint", "dockFrame"] {
        assert!(
            main.contains(chrome) && ui_source.contains(&format!("export function {chrome}")),
            "the dock's {chrome} must be drawn by the application"
        );
    }
    assert!(
        main.contains("toggle_dock(\"right\")") && ui.contains("export function detailToggle"),
        "the details pane must still be collapsible from the window chrome"
    );
    // The geometry is remembered; the arrangement is not, and deliberately.
    // `load` rebuilds every panel through the registry, so the panels this view
    // created are replaced by two it has no handle on -- and a panel it cannot
    // address is a panel it cannot repaint. Measured, the pane rendered twice
    // at startup and never again: the watchlist arrived and the pane went on
    // showing the empty state it had drawn before the data landed. So the
    // panels are always seeded here and only the details pane's width and
    // whether it is folded away are read back.
    assert!(
        main.contains("WORKSPACE_LAYOUT_KEY") && main.contains("dock_size(\"right\")"),
        "the details pane's width must be written back to storage"
    );
    assert!(
        !main.contains("workspaceDock.load("),
        "restoring panels loses the handles that repaint them; see the note above"
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
        main.contains("Popover.new(\"user-menu\")")
            && main.contains("Popover.new(\"allocation-help\")"),
        "both Popover scenarios must stay wired"
    );
    assert!(
        ui.contains(".role(\"menu_item\")") && ui.contains(".role(\"menu\")"),
        "the popup menu must announce itself as a menu"
    );
    assert!(ui.contains(".tooltip("), "pointer hints must stay wired");

    // Authorization opens the page itself. The address is only known once the
    // device code exists, and it is not one anyone reads.
    assert!(
        main.contains("open_url(authorization.verificationUri)")
            && !main.contains("device.verificationUri,\n              device.verificationUri,"),
        "sign-in must open the authorization page rather than print its URL"
    );
}

#[test]
fn price_chart_is_a_retained_child_view() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let chart =
        fs::read_to_string(app_dir().join("price_chart_view.js")).expect("price_chart_view.js");

    assert!(
        main.contains("cx.new(PriceChartView")
            && main.contains(".child(this.priceChart)")
            && main.contains("this.priceChart.set_props(")
            && main.contains("this.priceChart.release()"),
        "the root must create, update, mount, and release one retained price-chart child"
    );
    assert!(
        chart.contains("export default class PriceChartView extends View"),
        "the retained child must own the price-chart view lifecycle"
    );
    for root_owned_hover_state in ["chartPointer", "chartHoverFramePending", "chartHover"] {
        assert!(
            !main.contains(root_owned_hover_state),
            "root still owns chart-local state {root_owned_hover_state}"
        );
    }
}

#[test]
fn workspace_repaints_do_not_checkpoint_the_market_model() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let workspace = fs::read_to_string(app_dir().join("workspace.js")).expect("workspace.js");
    let panel = workspace
        .split("class WorkspacePanel extends View")
        .nth(1)
        .and_then(|source| source.split("export class WatchlistPanel").next())
        .expect("WorkspacePanel source");

    assert!(
        !panel.contains("update("),
        "a panel update makes gpui-shell checkpoint every object reachable through its app; \
         quote-driven repaints must refresh a panel without journalling the market model"
    );
    assert!(
        panel.contains("this.app = props?.app ?? workspaceApp()"),
        "the panel must still acquire its application once during initialization"
    );
    assert!(
        main.contains("cx.notify(this.watchlistPanel)")
            && main.contains("cx.notify(this.detailPanel)"),
        "shared-state panes must use GPUI-style targeted notification"
    );
    assert!(
        !main.contains("workspaceRevision") && !main.contains("const props = { revision:"),
        "pane repaint must not manufacture props only to cross the nested-view update path"
    );
}

#[test]
fn chart_publication_yields_to_interaction_and_is_rate_limited() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        main.contains("const CHART_PUBLISH_INTERVAL_MS = 500")
            && main.contains("Date.now() - this.chartPublishedAt >= CHART_PUBLISH_INTERVAL_MS"),
        "live quotes must not publish the complete five-day chart on every feed repaint"
    );
    assert!(
        main.contains("this.chartPublish = cx.timer.after(0")
            && main.contains("this.publishChart(cx)"),
        "selection and load handlers must defer the large chart update so their first frame can paint"
    );

    let select_quote = main
        .split("selectQuote(symbol, cx) {")
        .nth(1)
        .and_then(|source| source.split("\n  }").next())
        .expect("selectQuote source");
    let redraw = select_quote
        .find("this.redraw(cx)")
        .expect("selection redraw");
    let load = select_quote
        .find("this.loadSelectedChart(cx)")
        .expect("chart load");
    assert!(
        redraw < load,
        "the selected Watchlist row must be submitted for paint before chart loading/publishing starts"
    );
}

#[test]
fn release_build_resolves_packaged_application_resources() {
    let manifest = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .expect("Cargo.toml");
    let host = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/main.rs"))
        .expect("src/main.rs");

    assert!(
        manifest.contains("name = \"longbridge-lite\""),
        "the Cargo package and executable must use the release product name"
    );
    assert!(
        host.contains("LONGBRIDGE_LITE_APP_DIR")
            && host.contains("Resources").then_some(()).is_some()
            && host.contains("share").then_some(()).is_some(),
        "the host must resolve explicit, macOS, and portable application resource locations"
    );
    let resolver = host
        .split("fn application_dir()")
        .nth(1)
        .and_then(|source| source.split("\nfn ").next())
        .expect("application_dir resolver");
    let override_position = resolver
        .find("LONGBRIDGE_LITE_APP_DIR")
        .expect("environment override");
    let development_position = resolver
        .find("CARGO_MANIFEST_DIR")
        .expect("development fallback");
    assert!(
        override_position < development_position,
        "the source checkout may only be the final development fallback"
    );
}
